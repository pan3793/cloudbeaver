/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2024 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { observer } from 'mobx-react-lite';
import { useContext } from 'react';

import { AUTH_PROVIDER_LOCAL_ID } from '@cloudbeaver/core-authentication';
import { Button, getComputed, PlaceholderComponent, useResource, useTranslate } from '@cloudbeaver/core-blocks';
import { DatabaseAuthModelsResource, DBDriverResource } from '@cloudbeaver/core-connections';
import { useAuthenticationAction } from '@cloudbeaver/core-ui';

import { ConnectionFormActionsContext } from './ConnectFormActionsContext';
import type { IConnectionFormProps } from './IConnectionFormProps';

export const ConnectionFormBaseActions: PlaceholderComponent<IConnectionFormProps> = observer(function ConnectionFormBaseActions({
  state,
  onCancel,
}) {
  const actions = useContext(ConnectionFormActionsContext);

  if (!actions) {
    throw new Error('ConnectionFormActionsContext not provided');
  }

  const translate = useTranslate();
  const driverMap = useResource(ConnectionFormBaseActions, DBDriverResource, state.config.driverId || null);

  const driver = driverMap.data;
  const { data: authModel } = useResource(
    ConnectionFormBaseActions,
    DatabaseAuthModelsResource,
    getComputed(() => state.config.authModelId || state.info?.authModel || driver?.defaultAuthModel || null),
  );
  const authentication = useAuthenticationAction({
    providerId: authModel?.requiredAuth ?? state.info?.requiredAuth ?? AUTH_PROVIDER_LOCAL_ID,
  });

  const authorized = authentication.providerId === AUTH_PROVIDER_LOCAL_ID || authentication.authorized;

  return (
    <>
      {onCancel && (
        <Button type="button" disabled={state.disabled} mod={['outlined']} onClick={onCancel}>
          {translate('ui_processing_cancel')}
        </Button>
      )}
      <Button type="button" disabled={state.disabled || !authorized} mod={['outlined']} loader onClick={actions.test}>
        {translate('connections_connection_test')}
      </Button>
      <Button type="button" disabled={state.disabled || state.readonly} mod={['unelevated']} loader onClick={actions.save}>
        {translate(state.mode === 'edit' ? 'ui_processing_save' : 'ui_processing_create')}
      </Button>
    </>
  );
});
