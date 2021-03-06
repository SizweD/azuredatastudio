/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IConnectionProfile } from 'sql/platform/connection/common/interfaces';
import { IConnectionProfileGroup, ConnectionProfileGroup } from 'sql/platform/connection/common/connectionProfileGroup';
import { ConnectionProfile } from 'sql/platform/connection/common/connectionProfile';

/**
 * Interface for a configuration file that stores connection profiles.
 *
 * @export
 * @interface IConnectionConfig
 */
export interface IConnectionConfig {
	addConnection(profile: IConnectionProfile): Promise<IConnectionProfile>;
	addGroup(profileGroup: IConnectionProfileGroup): Promise<string>;
	getConnections(getWorkspaceConnections: boolean): ConnectionProfile[];
	getAllGroups(): IConnectionProfileGroup[];
	changeGroupIdForConnectionGroup(source: ConnectionProfileGroup, target: ConnectionProfileGroup): Promise<void>;
	changeGroupIdForConnection(source: ConnectionProfile, targetGroupId: string): Promise<void>;
	editGroup(group: ConnectionProfileGroup): Promise<void>;
	deleteConnection(profile: ConnectionProfile): Promise<void>;
	deleteGroup(group: ConnectionProfileGroup): Promise<void>;
	canChangeConnectionConfig(profile: ConnectionProfile, newGroupID: string): boolean;
}
