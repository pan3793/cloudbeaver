/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2024 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { Bootstrap, injectable } from '@cloudbeaver/core-di';
import { CommonDialogService, DialogueStateResult } from '@cloudbeaver/core-dialogs';
import { NotificationService } from '@cloudbeaver/core-events';
import type { IExecutionContextProvider } from '@cloudbeaver/core-executor';
import { type INodeNavigationData, NavNodeInfoResource, NavNodeManagerService } from '@cloudbeaver/core-navigation-tree';
import { isResourceOfType, ProjectInfoResource, ProjectsService } from '@cloudbeaver/core-projects';
import { CachedMapAllKey, CachedTreeChildrenKey } from '@cloudbeaver/core-resource';
import { getRmResourcePath, NAV_NODE_TYPE_RM_RESOURCE, ResourceManagerResource, RESOURCES_NODE_PATH } from '@cloudbeaver/core-resource-manager';
import { createPath, getPathName } from '@cloudbeaver/core-utils';
import { ActionService, DATA_CONTEXT_MENU, MenuService } from '@cloudbeaver/core-view';
import { NavigationTabsService } from '@cloudbeaver/plugin-navigation-tabs';
import { getResourceKeyFromNodeId } from '@cloudbeaver/plugin-navigation-tree-rm';
import { RESOURCE_NAME_REGEX, ResourceManagerService } from '@cloudbeaver/plugin-resource-manager';
import { ResourceManagerScriptsService, SaveScriptDialog, SCRIPTS_TYPE_ID } from '@cloudbeaver/plugin-resource-manager-scripts';
import {
  DATA_CONTEXT_SQL_EDITOR_STATE,
  ESqlDataSourceFeatures,
  getSqlEditorName,
  ISqlDataSource,
  LocalStorageSqlDataSource,
  MemorySqlDataSource,
  SQL_EDITOR_TOOLS_MENU,
  SqlDataSourceService,
  SqlEditorSettingsService,
} from '@cloudbeaver/plugin-sql-editor';
import { isSQLEditorTab, SqlEditorNavigatorService } from '@cloudbeaver/plugin-sql-editor-navigation-tab';

import { ACTION_SAVE_AS_SCRIPT } from './ACTION_SAVE_AS_SCRIPT';
import { ResourceSqlDataSource } from './ResourceSqlDataSource';
import { SqlEditorTabResourceService } from './SqlEditorTabResourceService';

@injectable()
export class PluginBootstrap extends Bootstrap {
  constructor(
    private readonly navNodeManagerService: NavNodeManagerService,
    private readonly navNodeInfoResource: NavNodeInfoResource,
    private readonly navigationTabsService: NavigationTabsService,
    private readonly notificationService: NotificationService,
    private readonly sqlEditorNavigatorService: SqlEditorNavigatorService,
    private readonly resourceManagerService: ResourceManagerService,
    private readonly projectsService: ProjectsService,
    private readonly projectInfoResource: ProjectInfoResource,
    private readonly sqlEditorTabResourceService: SqlEditorTabResourceService,
    private readonly commonDialogService: CommonDialogService,
    private readonly actionService: ActionService,
    private readonly menuService: MenuService,
    private readonly sqlDataSourceService: SqlDataSourceService,
    private readonly sqlEditorSettingsService: SqlEditorSettingsService,
    private readonly resourceManagerResource: ResourceManagerResource,
    private readonly resourceManagerScriptsService: ResourceManagerScriptsService,
  ) {
    super();
  }

  register(): void | Promise<void> {
    this.navNodeManagerService.onCanOpen.addHandler(this.canOpenHandler.bind(this));
    this.navNodeManagerService.navigator.addHandler(this.navigationHandler.bind(this));

    this.actionService.addHandler({
      id: 'scripts-base-handler',
      isActionApplicable: (context, action): boolean => {
        const state = context.tryGet(DATA_CONTEXT_SQL_EDITOR_STATE);

        if (!state) {
          return false;
        }

        if (!this.projectsService.activeProjects.some(project => project.canEditResources)) {
          return false;
        }

        const dataSource = this.sqlDataSourceService.get(state.editorId);

        if (action === ACTION_SAVE_AS_SCRIPT) {
          return dataSource instanceof MemorySqlDataSource || dataSource instanceof LocalStorageSqlDataSource;
        }

        return false;
      },
      handler: async (context, action) => {
        const state = context.get(DATA_CONTEXT_SQL_EDITOR_STATE);

        let dataSource: ISqlDataSource | ResourceSqlDataSource | undefined = this.sqlDataSourceService.get(state.editorId);

        if (!dataSource) {
          return;
        }

        if (action === ACTION_SAVE_AS_SCRIPT) {
          let projectId = dataSource.executionContext?.projectId ?? null;
          await this.projectInfoResource.load(CachedMapAllKey);
          const name = getSqlEditorName(state, dataSource);

          if (projectId) {
            const project = this.projectInfoResource.get(projectId);

            if (!project?.canEditResources) {
              projectId = null;
            }
          }

          const result = await this.commonDialogService.open(SaveScriptDialog, {
            defaultScriptName: name,
            projectId,
            validation: async ({ name, projectId }, setMessage) => {
              const trimmedName = name.trim();

              if (!projectId || !trimmedName.length) {
                return false;
              }

              if (!RESOURCE_NAME_REGEX.test(trimmedName)) {
                setMessage('plugin_resource_manager_scripts_script_name_invalid_characters_message');
                return false;
              }

              const project = this.projectInfoResource.get(projectId);
              const nameWithExtension = this.projectInfoResource.getNameWithExtension(projectId, SCRIPTS_TYPE_ID, trimmedName);
              const rootFolder = project ? this.resourceManagerScriptsService.getRootFolder(project) : undefined;
              const key = getRmResourcePath(projectId, rootFolder);

              try {
                await this.resourceManagerResource.load(CachedTreeChildrenKey(key));
                return !this.resourceManagerResource.has(createPath(key, nameWithExtension));
              } catch (exception: any) {
                return false;
              }
            },
          });

          if (result !== DialogueStateResult.Rejected && result !== DialogueStateResult.Resolved) {
            try {
              projectId = result.projectId;

              if (!projectId) {
                throw new Error('Project not selected');
              }

              const project = this.projectInfoResource.get(projectId);
              if (!project) {
                throw new Error('Project not found');
              }

              const nameWithoutExtension = result.name.trim();
              const scriptName = this.projectInfoResource.getNameWithExtension(projectId, SCRIPTS_TYPE_ID, nameWithoutExtension);
              const scriptsRootFolder = this.resourceManagerScriptsService.getRootFolder(project);
              const folderResourceKey = getResourceKeyFromNodeId(createPath(RESOURCES_NODE_PATH, projectId, scriptsRootFolder));

              if (!folderResourceKey) {
                this.notificationService.logError({ title: 'ui_error', message: 'plugin_sql_editor_navigation_tab_resource_save_script_error' });
                return;
              }

              const resourceKey = createPath(folderResourceKey, scriptName);

              await this.resourceManagerScriptsService.createScript(resourceKey, dataSource.executionContext, dataSource.script);

              dataSource = this.sqlDataSourceService.create(state, ResourceSqlDataSource.key, {
                script: dataSource.script,
                executionContext: dataSource.executionContext,
              });

              (dataSource as ResourceSqlDataSource).setResourceKey(resourceKey);

              this.notificationService.logSuccess({
                title: 'plugin_sql_editor_navigation_tab_resource_save_script_success',
                message: nameWithoutExtension,
              });

              if (!this.resourceManagerScriptsService.active) {
                this.resourceManagerScriptsService.togglePanel();
              }
            } catch (exception) {
              this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_save_script_error');
            }
          }
        }
      },
      getActionInfo: (context, action) => {
        if (action === ACTION_SAVE_AS_SCRIPT) {
          return {
            ...action.info,
            label: '',
          };
        }

        return action.info;
      },
    });

    this.menuService.addCreator({
      isApplicable: context => {
        const state = context.tryGet(DATA_CONTEXT_SQL_EDITOR_STATE);

        if (!state) {
          return false;
        }

        const dataSource = this.sqlDataSourceService.get(state.editorId);

        return (
          this.resourceManagerService.enabled &&
          context.get(DATA_CONTEXT_MENU) === SQL_EDITOR_TOOLS_MENU &&
          !!dataSource?.hasFeature(ESqlDataSourceFeatures.script)
        );
      },
      getItems: (context, items) => [...items, ACTION_SAVE_AS_SCRIPT],
    });
  }

  load(): void | Promise<void> {}

  private canOpenHandler(data: INodeNavigationData, contexts: IExecutionContextProvider<INodeNavigationData>): void {
    const nodeInfo = contexts.getContext(this.navNodeManagerService.navigationNavNodeContext);

    if (this.canOpen(data, contexts)) {
      nodeInfo.markOpen();
    }
  }

  private async navigationHandler(data: INodeNavigationData, contexts: IExecutionContextProvider<INodeNavigationData>) {
    if (!this.canOpen(data, contexts)) {
      return;
    }

    try {
      const resourceKey = getResourceKeyFromNodeId(data.nodeId);

      if (!resourceKey) {
        return;
      }

      const resource = await this.resourceManagerResource.load(resourceKey);

      const maxSize = this.sqlEditorSettingsService.settings.getValue('maxFileSize');
      const size = Math.round(resource.length / 1000); // kilobyte

      if (size > maxSize) {
        this.notificationService.logInfo({
          title: 'sql_editor_upload_script_max_size_title',
          message: `Max size: ${maxSize}KB\nFile size: ${size}KB`,
          autoClose: false,
        });

        return;
      }

      const tab = this.sqlEditorTabResourceService.getResourceTab(resourceKey);

      if (tab) {
        this.navigationTabsService.selectTab(tab.id);
      } else {
        const contextProvider = await this.sqlEditorNavigatorService.openNewEditor({
          name: getPathName(resourceKey),
          dataSourceKey: ResourceSqlDataSource.key,
        });

        const context = contextProvider.getContext(this.navigationTabsService.navigationTabContext);

        if (context.tab && isSQLEditorTab(context.tab)) {
          const dataSource = this.sqlDataSourceService.create(context.tab.handlerState, ResourceSqlDataSource.key) as ResourceSqlDataSource;

          dataSource.setResourceKey(resourceKey);
        }
      }
    } catch (exception) {
      this.notificationService.logException(exception as any, 'plugin_sql_editor_navigation_tab_resource_open_script_error');
    }
  }

  private canOpen(data: INodeNavigationData, contexts: IExecutionContextProvider<INodeNavigationData>): boolean {
    if (!this.resourceManagerService.enabled) {
      return false;
    }

    const nodeInfo = contexts.getContext(this.navNodeManagerService.navigationNavNodeContext);

    if (!nodeInfo.projectId) {
      return false;
    }

    const node = this.navNodeInfoResource.get(data.nodeId);

    const project = this.projectInfoResource.get(nodeInfo.projectId);
    if (!project) {
      return false;
    }

    const resourceType = this.projectInfoResource.getResourceType(project, SCRIPTS_TYPE_ID);
    if (!resourceType) {
      return false;
    }

    if (!node || node.nodeType !== NAV_NODE_TYPE_RM_RESOURCE || !isResourceOfType(resourceType, node.id)) {
      return false;
    }

    const resourceKey = getResourceKeyFromNodeId(node.id);

    if (!resourceKey) {
      return false;
    }

    return true;
  }
}
