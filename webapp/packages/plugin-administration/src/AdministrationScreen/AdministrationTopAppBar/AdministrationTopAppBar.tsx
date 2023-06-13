/*
 * CloudBeaver - Cloud Database Manager
 * Copyright (C) 2020-2023 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */
import { useService } from '@cloudbeaver/core-di';
import { TopNavBar } from '@cloudbeaver/plugin-top-app-bar';

import { AdministrationTopAppBarService } from './AdministrationTopAppBarService';

export function AdministrationTopAppBar() {
  const administrationTopAppBarService = useService(AdministrationTopAppBarService);

  return <TopNavBar container={administrationTopAppBarService.placeholder} />;
}
