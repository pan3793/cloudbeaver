/*
 * cloudbeaver - Cloud Database Manager
 * Copyright (C) 2020 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */

import { observer } from 'mobx-react';
import styled, { css } from 'reshadow';

import {
  Button, SnackbarWrapper, SnackbarStatus, SnackbarContent, SnackbarBody, SnackbarFooter
} from '@cloudbeaver/core-blocks';
import { useController } from '@cloudbeaver/core-di';
import { ENotificationType, NotificationComponentProps } from '@cloudbeaver/core-events';
import { useTranslate } from '@cloudbeaver/core-localization';
import { useStyles } from '@cloudbeaver/core-theming';
import { EDeferredState } from '@cloudbeaver/core-utils';

import { ExportNotificationController } from './ExportNotificationController';

const styles = css`
  source-name {
    composes: theme-typography--body2 from global;
    padding-top: 16px;
    max-height: 50px;
    overflow: hidden;

    & pre {
      margin: 0;
    }
  }
`;

type Props = NotificationComponentProps<{
  source: string;
}>;

export const ExportNotification: React.FC<Props> = observer(function ExportNotification({
  notification,
}) {
  const controller = useController(ExportNotificationController, notification);
  const translate = useTranslate();
  const getExportNotificationType = () => {
    if (controller.isPending) {
      return ENotificationType.Loading;
    } else {
      return controller.isSuccess ? ENotificationType.Info : ENotificationType.Error;
    }
  };

  return styled(useStyles(styles))(
    <SnackbarWrapper unclosable={controller.isPending} onClose={controller.delete}>
      <SnackbarStatus status={getExportNotificationType()} />
      <SnackbarContent>
        <SnackbarBody title={translate(controller.status)}>
          {controller.sourceName}
          {controller.task?.context.sourceName && (
            <pre title={controller.task?.context.sourceName}>
              {controller.task?.context.sourceName}
            </pre>
          )}
        </SnackbarBody>
        <SnackbarFooter timestamp={notification.timestamp}>
          {getExportNotificationType() === ENotificationType.Info && (
            <>
              <Button
                type="button"
                mod={['outlined']}
                onClick={controller.delete}
              >
                {translate('data_transfer_notification_delete')}
              </Button>
              <Button
                tag='a'
                href={controller.downloadUrl}
                mod={['unelevated']}
                download
                onClick={controller.download}
              >
                {translate('data_transfer_notification_download')}
              </Button>
            </>
          )}
          {getExportNotificationType() === ENotificationType.Error && (
            <Button
              type="button"
              mod={['outlined']}
              disabled={controller.isDetailsDialogOpen}
              onClick={controller.showDetails}
            >
              {translate('ui_errors_details')}
            </Button>
          )}
          {getExportNotificationType() === ENotificationType.Loading && (
            <Button
              type="button"
              mod={['outlined']}
              disabled={controller.process?.getState() === EDeferredState.CANCELLING}
              onClick={controller.cancel}
            >
              {translate('ui_processing_cancel')}
            </Button>
          )}
        </SnackbarFooter>
      </SnackbarContent>
    </SnackbarWrapper>

  );
});
