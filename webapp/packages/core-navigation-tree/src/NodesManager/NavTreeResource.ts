/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2024 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { action, computed, makeObservable, observable, runInAction } from 'mobx';

import { AppAuthService, UserInfoResource } from '@cloudbeaver/core-authentication';
import { injectable } from '@cloudbeaver/core-di';
import { Executor, ExecutorInterrupter, IExecutionContext, IExecutor } from '@cloudbeaver/core-executor';
import { ProjectInfoResource } from '@cloudbeaver/core-projects';
import {
  CACHED_RESOURCE_DEFAULT_PAGE_OFFSET,
  CachedMapAllKey,
  CachedMapResource,
  CachedResourceOffsetPageKey,
  CachedResourceOffsetPageListKey,
  type ICachedResourceMetadata,
  isResourceAlias,
  isResourceKeyList,
  ResourceError,
  type ResourceKey,
  resourceKeyList,
  type ResourceKeyList,
  type ResourceKeySimple,
  ResourceKeyUtils,
} from '@cloudbeaver/core-resource';
import { SessionDataResource } from '@cloudbeaver/core-root';
import { DetailsError, NavNodeChildrenQuery as fake, GraphQLService } from '@cloudbeaver/core-sdk';
import { flat, getPathName, getPathParent, isDefined, isUndefined, MetadataMap } from '@cloudbeaver/core-utils';

import { NavTreeSettingsService } from '../NavTreeSettingsService';
import type { NavNode } from './EntityTypes';
import { NavNodeInfoResource, ROOT_NODE_PATH } from './NavNodeInfoResource';

// TODO: so much dirty
export interface NodePath {
  parentPath: string;
}

type NavNodeChildrenQuery = fake & NodePath;

interface INodeMetadata extends ICachedResourceMetadata {
  withDetails: boolean;
}

export interface INavNodeMoveData {
  key: ResourceKey<string>;
  target: string;
}

export interface INavNodeRenameData {
  projectId?: string;
  nodeId: string;
  newNodeId: string;
}

@injectable()
export class NavTreeResource extends CachedMapResource<string, string[], Record<string, unknown>, INodeMetadata> {
  readonly beforeNodeDelete: IExecutor<ResourceKeySimple<string>>;
  readonly onNodeRefresh: IExecutor<string>;
  readonly onNodeRename: IExecutor<INavNodeRenameData>;
  readonly onNodeMove: IExecutor<INavNodeMoveData>;

  get childrenLimit(): number {
    return this.navTreeSettingsService.settings.getValue('childrenLimit');
  }

  constructor(
    private readonly graphQLService: GraphQLService,
    private readonly navNodeInfoResource: NavNodeInfoResource,
    private readonly navTreeSettingsService: NavTreeSettingsService,
    private readonly sessionDataResource: SessionDataResource,
    private readonly userInfoResource: UserInfoResource,
    private readonly projectInfoResource: ProjectInfoResource,
    appAuthService: AppAuthService,
  ) {
    super();

    this.beforeNodeDelete = new Executor();
    this.onNodeRename = new Executor();
    this.onNodeMove = new Executor();

    makeObservable<this, 'setNavObject'>(this, {
      childrenLimit: computed,
      setDetails: action,
      setNavObject: action,
      moveToNode: action,
      deleteInNode: action,
      unshiftToNode: action,
      pushToNode: action,
    });

    appAuthService.requireAuthentication(this);
    // this.preloadResource(connectionInfo, () => CachedMapAllKey);

    this.onNodeRefresh = new Executor<string>(null, (a, b) => a === b);

    // navNodeInfoResource.preloadResource(this);
    navNodeInfoResource.connect(this);
    this.outdateResource(navNodeInfoResource);
    this.updateResource(navNodeInfoResource);
    this.sync(
      this.projectInfoResource,
      () => CachedMapAllKey,
      () => CachedMapAllKey,
    );
    this.projectInfoResource.onDataOutdated.addHandler(() => this.markTreeOutdated(resourceKeyList(this.keys)));
    this.sessionDataResource.onDataOutdated.addHandler(() => this.markTreeOutdated(resourceKeyList(this.keys)));
    this.userInfoResource.onUserChange.addHandler(
      action(() => {
        this.clear();
        this.navNodeInfoResource.clear(); // TODO: need more convenient way
      }),
    );
  }

  async preloadNodeParents(parents: string[], nextNode?: string): Promise<boolean> {
    if (parents.length === 0) {
      return true;
    }
    parents = [...parents];

    let parent: string | undefined;
    let children: string[] = [];

    while (parents.length > 0) {
      const next = parents.shift()!;
      if (parent !== undefined && !children.includes(next)) {
        return false;
      }
      await this.scheduler.waitRelease(next);

      if (this.isLoadable(next)) {
        children = await this.load(next);
      } else {
        children = this.get(next) || [];
      }
      parent = next;
    }

    if (nextNode && !children.includes(nextNode)) {
      return false;
    }

    return true;
  }

  async refreshTree(navNodeId: string, silent = false): Promise<void> {
    await this.graphQLService.sdk.navRefreshNode({
      nodePath: navNodeId,
    });

    if (!silent) {
      this.markTreeOutdated(navNodeId);
    }
    await this.onNodeRefresh.execute(navNodeId);
  }

  markTreeOutdated(navNodeId: ResourceKeySimple<string>): void {
    this.markOutdated(resourceKeyList(this.getNestedChildren(navNodeId)));
  }

  setDetails(keyObject: ResourceKeySimple<string>, state: boolean): void {
    const list = resourceKeyList(ResourceKeyUtils.mapArray(keyObject, key => this.getNestedChildren(key)).flat());
    this.navNodeInfoResource.setDetails(list, state);

    this.metadata.update(list, metadata => {
      if (!metadata.withDetails && state) {
        metadata.outdated = true;
        metadata.outdatedIncludes = observable([...metadata.includes]);
      }
      metadata.withDetails = state;
    });
  }

  async deleteNode(key: ResourceKeySimple<string>): Promise<void> {
    const contexts = await this.beforeNodeDelete.execute(key);

    if (ExecutorInterrupter.isInterrupted(contexts)) {
      return;
    }

    const nodePaths = ResourceKeyUtils.toArray(key);

    await this.performUpdate(key, [], async () => {
      const deletedPaths: string[] = [];

      try {
        for (const path of nodePaths) {
          await this.graphQLService.sdk.navDeleteNodes({ nodePaths: [path] });
          deletedPaths.push(path);
        }
      } finally {
        runInAction(() => {
          const deletedNodes: string[] = [];
          const deletionMap = new Map<string, string[]>();

          for (const path of deletedPaths) {
            const node = this.navNodeInfoResource.get(path);

            if (node) {
              deletedNodes.push(path);

              if (node.parentId !== undefined) {
                const deletedIds = deletionMap.get(node.parentId) ?? [];
                deletionMap.set(node.parentId, deletedIds);
              }
            }
          }

          const keys = resourceKeyList([...deletionMap.keys()]);
          const nodes = [...deletionMap.values()];

          this.delete(resourceKeyList(deletedNodes));
          this.deleteInNode(keys, nodes);
        });
      }
    });
  }

  async moveTo(key: ResourceKeySimple<string>, target: string): Promise<void> {
    const parents = Array.from(new Set(ResourceKeyUtils.mapArray(key, key => this.navNodeInfoResource.get(key)?.parentId).filter(isDefined)));

    await this.performUpdate(resourceKeyList(parents), [], async () => {
      this.markLoading(target, true);

      try {
        await this.graphQLService.sdk.navMoveTo({
          nodePaths: ResourceKeyUtils.toArray(key),
          folderPath: target,
        });

        this.moveToNode(key, target);
        this.markLoaded(target);
      } finally {
        this.markLoading(target, false);
      }
    });

    this.markOutdated(resourceKeyList([...parents, target]));
    await this.onNodeMove.execute({ key, target });
  }

  async setFilter(nodePath: string, include?: string[], exclude?: string[]) {
    await this.graphQLService.sdk.navSetFolderFilter({
      nodePath,
      exclude,
      include,
    });

    this.refreshTree(nodePath);
  }

  async changeName(node: NavNode, name: string): Promise<string> {
    const parentId = node.parentId;
    if (isUndefined(parentId)) {
      throw new Error("Root node can't be renamed");
    }
    const newNodeId = await this.performUpdate(parentId, [], async () => {
      this.markLoading(node.id, true);
      try {
        await this.graphQLService.sdk.navRenameNode({
          nodePath: node.id,
          newName: name,
        });

        const parts = node.id.split('/');
        parts.splice(parts.length - 1, 1, name);

        this.markTreeOutdated(parentId);
        this.markLoaded(node.id);
        return parts.join('/');
      } finally {
        this.markLoading(node.id, false);
      }
    });

    await this.onNodeRename.execute({
      projectId: node.projectId,
      nodeId: node.id,
      newNodeId,
    });
    return newNodeId;
  }

  moveSync(from: string, to: string): void {
    const toParent = getPathParent(to);
    const fromParent = getPathParent(from);

    this.pushToNode(toParent, [to]);

    const node = this.navNodeInfoResource.get(from);
    if (node) {
      node.id = to;
      node.name = getPathName(to);
      node.parentId = toParent;
      this.navNodeInfoResource.set(to, node);
    }

    this.deleteInNode(fromParent, [from]);

    this.markOutdated(resourceKeyList([toParent, fromParent]));
  }

  moveToNode(key: string, target: string): void;
  moveToNode(key: ResourceKeyList<string>, target: string): void;
  moveToNode(keyObject: ResourceKeySimple<string>, target: string): void;
  moveToNode(keyObject: ResourceKeySimple<string>, target: string): void {
    ResourceKeyUtils.forEach(keyObject, key => {
      const parentId = this.navNodeInfoResource.getParent(key);

      if (parentId !== undefined) {
        const currentValue = this.data.get(parentId);

        if (currentValue) {
          const children = currentValue.filter(value => value !== key);
          this.dataSet(parentId, children);
        }
      }

      this.navNodeInfoResource.setParent(key, target);
    });

    this.pushToNode(target, ResourceKeyUtils.toArray(keyObject));
    this.markUpdated(ResourceKeyUtils.join(target, keyObject));
    this.onItemUpdate.execute(keyObject);
  }

  deleteInNode(key: string, value: string[]): void;
  deleteInNode(key: ResourceKeyList<string>, value: string[][]): void;
  deleteInNode(keyObject: ResourceKeySimple<string>, valueObject: string[] | string[][]): void;
  deleteInNode(keyObject: ResourceKeySimple<string>, valueObject: string[] | string[][]): void {
    const deletedKeys: string[] = [];

    ResourceKeyUtils.forEach(keyObject, (key, i) => {
      const values = i === -1 ? (valueObject as string[]) : (valueObject as string[][])[i];
      const currentValue = this.data.get(key);

      if (currentValue) {
        const children = currentValue.filter(value => !values.includes(value));
        this.dataSet(key, children);
      }

      deletedKeys.push(...values);
    });

    this.delete(resourceKeyList(deletedKeys));
    this.markOutdated(keyObject);
    this.onItemUpdate.execute(keyObject);
  }

  unshiftToNode(key: string, value: string[]): void;
  unshiftToNode(key: ResourceKeyList<string>, value: string[][]): void;
  unshiftToNode(keyObject: ResourceKeySimple<string>, valueObject: string[] | string[][]): void {
    ResourceKeyUtils.forEach(keyObject, (key, i) => {
      const values = i === -1 ? (valueObject as string[]) : (valueObject as string[][])[i];
      const currentValue = this.data.get(key) || [];

      currentValue.unshift(...values);
      this.dataSet(key, currentValue);
    });

    this.markUpdated(keyObject);
    this.onItemUpdate.execute(keyObject);
  }

  pushToNode(key: string, value: string[]): void;
  pushToNode(key: ResourceKeyList<string>, value: string[][]): void;
  pushToNode(keyObject: ResourceKeySimple<string>, valueObject: string[] | string[][]): void {
    ResourceKeyUtils.forEach(keyObject, (key, i) => {
      const values = i === -1 ? (valueObject as string[]) : (valueObject as string[][])[i];
      const currentValue = this.data.get(key) || [];

      currentValue.push(...values);
      this.dataSet(key, currentValue);
    });

    this.markUpdated(keyObject);
    this.onItemUpdate.execute(keyObject);
  }

  insertToNode(nodeId: string, index: number, ...nodes: string[]): void {
    const currentValue = this.data.get(nodeId) || [];

    currentValue.splice(index, 0, ...nodes);
    this.dataSet(nodeId, currentValue);

    this.markUpdated(nodeId);
    this.onItemUpdate.execute(nodeId);
  }

  set(key: string, value: string[]): void;
  set(key: ResourceKeyList<string>, value: string[][]): void;
  set(keyObject: ResourceKeySimple<string>, valueObject: string[] | string[][]): void {
    const childrenToRemove: string[] = [];
    const children: string[] = [];

    if (isResourceKeyList(keyObject)) {
      valueObject = valueObject as string[][];
      children.push(...flat(valueObject));

      const oldChildren = flat(this.get(keyObject));
      childrenToRemove.push(
        ...oldChildren.filter<string>((navNodeId): navNodeId is string => navNodeId !== undefined && !children.includes(navNodeId)),
      );
    } else {
      valueObject = valueObject as string[];
      children.push(...valueObject);

      const oldChildren = this.get(keyObject) || [];
      childrenToRemove.push(...oldChildren.filter(navNodeId => !children.includes(navNodeId)));
    }

    this.delete(resourceKeyList(childrenToRemove));
    this.cleanError(resourceKeyList(children));
    super.set(keyObject, valueObject);
  }

  delete(key: string): void;
  delete(key: ResourceKeyList<string>): void;
  delete(key: ResourceKeySimple<string>): void;
  delete(key: ResourceKeySimple<string>): void {
    const items = resourceKeyList(this.getNestedChildren(key));

    if (items.length === 0) {
      return;
    }

    super.delete(items);
    this.navNodeInfoResource.delete(items.exclude(key));
  }

  protected async preLoadData(key: ResourceKey<string>, contexts: IExecutionContext<ResourceKey<string>>): Promise<void> {
    await ResourceKeyUtils.forEachAsync(key, async nodeId => {
      if (isResourceAlias(nodeId)) {
        return;
      }

      if (!this.navNodeInfoResource.has(nodeId) && nodeId !== ROOT_NODE_PATH) {
        await this.navNodeInfoResource.loadNodeParents(nodeId);
      }
      const parents = this.navNodeInfoResource.getParents(nodeId);
      const preloaded = await this.preloadNodeParents(parents, nodeId);

      if (!preloaded) {
        const cause = new DetailsError(`Entity not found:\n"${nodeId}"\nPath:\n${parents.map(parent => `"${parent}"`).join('\n')}`);
        const error = new ResourceError(this, key, undefined, 'Entity not found', { cause });
        ExecutorInterrupter.interrupt(contexts);
        throw this.markError(error, key);
      }
    });
  }

  protected async loader(originalKey: ResourceKey<string>): Promise<Map<string, string[]>> {
    const pageKey =
      this.aliases.isAlias(originalKey, CachedResourceOffsetPageKey) || this.aliases.isAlias(originalKey, CachedResourceOffsetPageListKey);
    const allKey = this.aliases.isAlias(originalKey, CachedMapAllKey);

    if (allKey) {
      throw new Error('Loading all nodes is prohibited');
    }

    const offset = pageKey?.options.offset ?? CACHED_RESOURCE_DEFAULT_PAGE_OFFSET;
    const limit = pageKey?.options.limit ?? this.childrenLimit;
    const values: NavNodeChildrenQuery[] = [];

    await ResourceKeyUtils.forEachAsync(originalKey, async key => {
      const nodeId = pageKey?.target ?? key;
      const navNodeChildren = await this.loadNodeChildren(nodeId, offset, limit);
      values.push(navNodeChildren);

      this.offsetPagination.setPageEnd(
        CachedResourceOffsetPageKey(offset, navNodeChildren.navNodeChildren.length).setTarget(nodeId),
        navNodeChildren.navNodeChildren.length === limit,
      );
    });

    this.setNavObject(values, offset, limit);

    return this.data;
  }

  getNestedChildren(navNode: ResourceKeySimple<string>): string[] {
    const nestedChildren: string[] = [];
    let prevChildren: string[];

    if (isResourceKeyList(navNode)) {
      prevChildren = navNode.concat();
    } else {
      prevChildren = [navNode, ...(this.get(navNode) || [])];
    }

    nestedChildren.push(...prevChildren);

    while (prevChildren.length) {
      const nodeKey = prevChildren.shift()!;
      const children = this.get(nodeKey) || [];
      prevChildren.push(...children);
      nestedChildren.push(...children);
    }

    return nestedChildren;
  }

  private setNavObject(data: NavNodeChildrenQuery | NavNodeChildrenQuery[], offset: number, limit: number): void {
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return;
      }

      for (const node of data) {
        const metadata = this.metadata.get(node.parentPath);

        this.setDetails(resourceKeyList([node.navNodeInfo.id, ...node.navNodeChildren.map(node => node.id)]), metadata.withDetails);
      }

      this.navNodeInfoResource.set(
        resourceKeyList([...data.map(data => data.parentPath), ...data.map(data => data.navNodeChildren.map(node => node.id)).flat()]),
        [
          ...data.map(data => this.navNodeInfoResource.navNodeInfoToNavNode(data.navNodeInfo)).flat(),
          ...data.map(data => data.navNodeChildren.map(node => this.navNodeInfoResource.navNodeInfoToNavNode(node, data.parentPath))).flat(),
        ],
      );

      this.set(
        resourceKeyList(data.map(data => data.parentPath)),
        data.map(data => this.insertSlice(data, offset, limit)),
      );
    } else {
      const metadata = this.metadata.get(data.parentPath);

      this.setDetails(resourceKeyList([data.navNodeInfo.id, ...data.navNodeChildren.map(node => node.id)]), metadata.withDetails);

      this.navNodeInfoResource.set(resourceKeyList([data.parentPath, ...data.navNodeChildren.map(node => node.id)]), [
        this.navNodeInfoResource.navNodeInfoToNavNode(data.navNodeInfo),
        ...data.navNodeChildren.map(node => this.navNodeInfoResource.navNodeInfoToNavNode(node, data.parentPath)),
      ]);

      this.set(data.parentPath, this.insertSlice(data, offset, limit));
    }
  }

  private insertSlice(data: NavNodeChildrenQuery, offset: number, limit: number): string[] {
    let children = [...(this.get(data.parentPath) || [])];

    children.splice(offset, limit, ...data.navNodeChildren.map(node => node.id));

    if (data.navNodeChildren.length < limit) {
      children.splice(offset + data.navNodeChildren.length, children.length - offset - data.navNodeChildren.length);
    }

    children = children.filter((value, index, self) => self.indexOf(value) === index);

    return children;
  }

  private async loadNodeChildren(parentPath: string, offset: number, limit: number): Promise<NavNodeChildrenQuery> {
    const metadata = this.metadata.get(parentPath);
    const { navNodeChildren, navNodeInfo } = await this.graphQLService.sdk.navNodeChildren({
      parentPath,
      offset,
      limit,
      withDetails: metadata.withDetails,
      withFilters: false,
    });

    return { navNodeChildren, navNodeInfo, parentPath };
  }

  protected getDefaultMetadata(key: string, metadata: MetadataMap<string, INodeMetadata>): INodeMetadata {
    return Object.assign(super.getDefaultMetadata(key, metadata), {
      withDetails: false,
    });
  }

  protected validateKey(key: string): boolean {
    return typeof key === 'string';
  }
}
