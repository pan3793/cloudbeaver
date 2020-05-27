/*
 * cloudbeaver - Cloud Database Manager
 * Copyright (C) 2020 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */

import { IServiceInjector, PluginManifest } from '@dbeaver/core/di';

import { UsersAdministrationService } from './Administration/Users/UsersAdministrationService';
import { UsersManagerService } from './Administration/UsersManagerService';
import { AuthenticationService } from './AuthenticationService';
import { AuthInfoService } from './AuthInfoService';
import { AuthMenuService } from './AuthMenuService';
import { AuthProviderService } from './AuthProviderService';
import { Bootstrap } from './Bootstrap';
import { AuthDialogService } from './Dialog/AuthDialogService';

export const manifest: PluginManifest = {
  info: {
    name: 'Authentication',
  },

  providers: [
    AuthenticationService,
    AuthInfoService,
    AuthProviderService,
    AuthDialogService,
    AuthMenuService,
    UsersAdministrationService,
    UsersManagerService,
  ],

  async initialize(services: IServiceInjector) {
    services
      .resolveServiceByClass(Bootstrap)
      .bootstrap();
  },
};
