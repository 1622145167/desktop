// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable max-lines */
'use strict';

import {dialog, ipcMain} from 'electron';
import {Tuple as tuple} from '@bloomberg/record-tuple-polyfill';

import {BROWSER_HISTORY_PUSH, LOAD_SUCCESS, MAIN_WINDOW_SHOWN} from 'common/communication';
import Config from 'common/config';
import {MattermostServer} from 'common/servers/MattermostServer';
import {getTabViewName} from 'common/tabs/TabView';
import {equalUrlsIgnoringSubpath} from 'common/utils/url';

import MainWindow from 'main/windows/mainWindow';

import {MattermostView} from './MattermostView';
import {ViewManager} from './viewManager';
import LoadingScreen from './loadingScreen';

jest.mock('electron', () => ({
    app: {
        getAppPath: () => '/path/to/app',
    },
    dialog: {
        showErrorBox: jest.fn(),
    },
    ipcMain: {
        emit: jest.fn(),
        on: jest.fn(),
        handle: jest.fn(),
    },
}));
jest.mock('common/config', () => ({
    teams: [],
}));
jest.mock('common/tabs/TabView', () => ({
    getTabViewName: jest.fn((a, b) => `${a}-${b}`),
    TAB_MESSAGING: 'tab',
}));

jest.mock('common/servers/MattermostServer', () => ({
    MattermostServer: jest.fn(),
}));

jest.mock('common/utils/url', () => ({
    isTeamUrl: jest.fn(),
    isAdminUrl: jest.fn(),
    cleanPathName: jest.fn(),
    parseURL: (url) => {
        try {
            return new URL(url);
        } catch (e) {
            return null;
        }
    },
    equalUrlsIgnoringSubpath: jest.fn(),
}));

jest.mock('main/i18nManager', () => ({
    localizeMessage: jest.fn(),
}));

jest.mock('main/server/serverInfo', () => ({
    ServerInfo: jest.fn(),
}));
jest.mock('main/views/loadingScreen', () => ({
    show: jest.fn(),
    fade: jest.fn(),
}));
jest.mock('main/windows/mainWindow', () => ({
    get: jest.fn(),
}));
jest.mock('./MattermostView', () => ({
    MattermostView: jest.fn(),
}));

jest.mock('./modalManager', () => ({
    showModal: jest.fn(),
}));
jest.mock('./webContentEvents', () => ({}));
jest.mock('../appState', () => ({}));

describe('main/views/viewManager', () => {
    describe('loadView', () => {
        const viewManager = new ViewManager({});
        const onceFn = jest.fn();
        const loadFn = jest.fn();
        const destroyFn = jest.fn();

        beforeEach(() => {
            viewManager.showByName = jest.fn();
            viewManager.getServerView = jest.fn().mockImplementation((srv, tabName) => ({name: `${srv.name}-${tabName}`}));
            MattermostView.mockImplementation((tab) => ({
                on: jest.fn(),
                load: loadFn,
                once: onceFn,
                destroy: destroyFn,
                name: tab.name,
            }));
        });

        afterEach(() => {
            jest.resetAllMocks();
            viewManager.closedViews = new Map();
            viewManager.views = new Map();
        });

        it('should add closed tabs to closedViews', () => {
            viewManager.loadView({name: 'server1'}, {}, {name: 'tab1', isOpen: false});
            expect(viewManager.closedViews.has('server1-tab1')).toBe(true);
        });

        it('should remove from remove from closedViews when the tab is open', () => {
            viewManager.closedViews.set('server1-tab1', {});
            expect(viewManager.closedViews.has('server1-tab1')).toBe(true);
            viewManager.loadView({name: 'server1'}, {}, {name: 'tab1', isOpen: true});
            expect(viewManager.closedViews.has('server1-tab1')).toBe(false);
        });

        it('should add view to views map and add listeners', () => {
            viewManager.loadView({name: 'server1'}, {}, {name: 'tab1', isOpen: true}, 'http://server-1.com/subpath');
            expect(viewManager.views.has('server1-tab1')).toBe(true);
            expect(onceFn).toHaveBeenCalledWith(LOAD_SUCCESS, viewManager.activateView);
            expect(loadFn).toHaveBeenCalledWith('http://server-1.com/subpath');
        });
    });

    describe('handleAppLoggedIn', () => {
        const viewManager = new ViewManager({});

        afterEach(() => {
            jest.resetAllMocks();
        });

        it('should reload view when URL is not on subpath of original server URL', () => {
            const view = {
                load: jest.fn(),
                view: {
                    webContents: {
                        getURL: () => 'http://server-2.com/subpath',
                    },
                },
                tab: {
                    url: new URL('http://server-1.com/'),
                },
            };
            viewManager.views.set('view1', view);
            viewManager.handleAppLoggedIn({}, 'view1');
            expect(view.load).toHaveBeenCalledWith(new URL('http://server-1.com/'));
        });

        it('should not reload if URLs are matching', () => {
            const view = {
                load: jest.fn(),
                view: {
                    webContents: {
                        getURL: () => 'http://server-1.com/',
                    },
                },
                tab: {
                    url: new URL('http://server-1.com/'),
                },
            };
            viewManager.views.set('view1', view);
            viewManager.handleAppLoggedIn({}, 'view1');
            expect(view.load).not.toHaveBeenCalled();
        });

        it('should not reload if URL is subpath of server URL', () => {
            const view = {
                load: jest.fn(),
                view: {
                    webContents: {
                        getURL: () => 'http://server-1.com/subpath',
                    },
                },
                tab: {
                    url: new URL('http://server-1.com/'),
                },
            };
            viewManager.views.set('view1', view);
            viewManager.handleAppLoggedIn({}, 'view1');
            expect(view.load).not.toHaveBeenCalled();
        });
    });

    describe('reloadConfiguration', () => {
        const viewManager = new ViewManager();

        beforeEach(() => {
            viewManager.loadView = jest.fn();
            viewManager.showByName = jest.fn();
            viewManager.showInitial = jest.fn();

            const mainWindow = {
                webContents: {
                    send: jest.fn(),
                },
            };
            MainWindow.get.mockReturnValue(mainWindow);

            viewManager.getServerView = jest.fn().mockImplementation((srv, tabName) => ({
                name: `${srv.name}-${tabName}`,
                urlTypeTuple: tuple(`http://${srv.name}.com/`, tabName),
                url: new URL(`http://${srv.name}.com`),
            }));
            MattermostServer.mockImplementation((server) => ({
                name: server.name,
                url: new URL(server.url),
            }));
            const onceFn = jest.fn();
            const loadFn = jest.fn();
            const destroyFn = jest.fn();
            MattermostView.mockImplementation((tab) => ({
                on: jest.fn(),
                load: loadFn,
                once: onceFn,
                destroy: destroyFn,
                name: tab.name,
                urlTypeTuple: tab.urlTypeTuple,
                updateServerInfo: jest.fn(),
                tab,
            }));
        });

        afterEach(() => {
            jest.resetAllMocks();
            delete viewManager.currentView;
            viewManager.closedViews = new Map();
            viewManager.views = new Map();
        });

        it('should recycle existing views', () => {
            Config.teams = [
                {
                    name: 'server1',
                    url: 'http://server1.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: true,
                        },
                    ],
                },
            ];
            const makeSpy = jest.spyOn(viewManager, 'makeView');
            const view = new MattermostView({
                name: 'server1-tab1',
                urlTypeTuple: tuple(new URL('http://server1.com').href, 'tab1'),
                server: 'server1',
            });
            viewManager.views.set('server1-tab1', view);
            viewManager.reloadConfiguration();
            expect(viewManager.views.get('server1-tab1')).toBe(view);
            expect(makeSpy).not.toHaveBeenCalled();
            makeSpy.mockRestore();
        });

        it('should close tabs that arent open', () => {
            Config.teams = [
                {
                    name: 'server1',
                    url: 'http://server1.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: false,
                        },
                    ],
                },
            ];
            viewManager.reloadConfiguration();
            expect(viewManager.closedViews.has('server1-tab1')).toBe(true);
        });

        it('should create new views for new tabs', () => {
            const makeSpy = jest.spyOn(viewManager, 'makeView');
            Config.teams = [
                {
                    name: 'server1',
                    url: 'http://server1.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: true,
                        },
                    ],
                },
            ];
            viewManager.reloadConfiguration();
            expect(makeSpy).toHaveBeenCalledWith(
                {
                    name: 'server1',
                    url: new URL('http://server1.com'),
                },
                expect.any(Object),
                {
                    name: 'tab1',
                    isOpen: true,
                },
                'http://server1.com/',
            );
            makeSpy.mockRestore();
        });

        it('should set focus to current view on reload', () => {
            const view = {
                name: 'server1-tab1',
                tab: {
                    server: {
                        name: 'server-1',
                    },
                    name: 'server1-tab1',
                    url: new URL('http://server1.com'),
                },
                urlTypeTuple: tuple('http://server1.com/', 'tab1'),
                destroy: jest.fn(),
                updateServerInfo: jest.fn(),
            };
            viewManager.currentView = 'server1-tab1';
            viewManager.views.set('server1-tab1', view);
            Config.teams = [
                {
                    name: 'server1',
                    url: 'http://server1.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: true,
                        },
                    ],
                },
            ];
            viewManager.reloadConfiguration();
            expect(viewManager.showByName).toHaveBeenCalledWith('server1-tab1');
        });

        it('should show initial if currentView has been removed', () => {
            const view = {
                name: 'server1-tab1',
                tab: {
                    name: 'server1-tab1',
                    url: new URL('http://server1.com'),
                },
                urlTypeTuple: ['http://server.com/', 'tab1'],
                destroy: jest.fn(),
                updateServerInfo: jest.fn(),
            };
            viewManager.currentView = 'server1-tab1';
            viewManager.views.set('server1-tab1', view);
            Config.teams = [
                {
                    name: 'server2',
                    url: 'http://server2.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: true,
                        },
                    ],
                },
            ];
            viewManager.reloadConfiguration();
            expect(viewManager.showInitial).toBeCalled();
        });

        it('should remove unused views', () => {
            const view = {
                name: 'server1-tab1',
                tab: {
                    name: 'server1-tab1',
                    url: new URL('http://server1.com'),
                },
                destroy: jest.fn(),
            };
            viewManager.views.set('server1-tab1', view);
            Config.teams = [
                {
                    name: 'server2',
                    url: 'http://server2.com',
                    order: 1,
                    tabs: [
                        {
                            name: 'tab1',
                            isOpen: true,
                        },
                    ],
                },
            ];
            viewManager.reloadConfiguration();
            expect(view.destroy).toBeCalled();
            expect(viewManager.showInitial).toBeCalled();
        });
    });

    describe('showInitial', () => {
        const viewManager = new ViewManager({});

        beforeEach(() => {
            Config.teams = [{
                name: 'server-1',
                order: 1,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: false,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: true,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
            }, {
                name: 'server-2',
                order: 0,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: false,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: true,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
            }];
            viewManager.showByName = jest.fn();
            getTabViewName.mockImplementation((server, tab) => `${server}_${tab}`);
        });

        afterEach(() => {
            jest.resetAllMocks();
            delete viewManager.lastActiveServer;
        });

        it('should show first server and first open tab in order when last active not defined', () => {
            viewManager.showInitial();
            expect(viewManager.showByName).toHaveBeenCalledWith('server-2_tab-3');
        });

        it('should show first tab in order of last active server', () => {
            viewManager.lastActiveServer = 1;
            viewManager.showInitial();
            expect(viewManager.showByName).toHaveBeenCalledWith('server-1_tab-3');
        });

        it('should show last active tab of first server', () => {
            Config.teams = [{
                name: 'server-1',
                order: 1,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: false,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: true,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
            }, {
                name: 'server-2',
                order: 0,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: false,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: true,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
                lastActiveTab: 2,
            }];
            viewManager.showInitial();
            expect(viewManager.showByName).toHaveBeenCalledWith('server-2_tab-2');
        });

        it('should show next tab when last active tab is closed', () => {
            Config.teams = [{
                name: 'server-1',
                order: 1,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: false,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: true,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
            }, {
                name: 'server-2',
                order: 0,
                tabs: [
                    {
                        name: 'tab-1',
                        order: 0,
                        isOpen: true,
                    },
                    {
                        name: 'tab-2',
                        order: 2,
                        isOpen: false,
                    },
                    {
                        name: 'tab-3',
                        order: 1,
                        isOpen: true,
                    },
                ],
                lastActiveTab: 2,
            }];
            viewManager.showInitial();
            expect(viewManager.showByName).toHaveBeenCalledWith('server-2_tab-1');
        });

        it('should open new server modal when no servers exist', () => {
            viewManager.mainWindow = {
                webContents: {
                    send: jest.fn(),
                },
            };
            Config.teams = [];
            viewManager.showInitial();
            expect(ipcMain.emit).toHaveBeenCalledWith(MAIN_WINDOW_SHOWN);
        });
    });

    describe('showByName', () => {
        const viewManager = new ViewManager({});
        const baseView = {
            isReady: jest.fn(),
            isErrored: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            needsLoadingScreen: jest.fn(),
            window: {
                webContents: {
                    send: jest.fn(),
                },
            },
            tab: {
                server: {
                    name: 'server-1',
                },
                type: 'tab-1',
            },
        };

        beforeEach(() => {
            viewManager.getCurrentView = jest.fn();
        });

        afterEach(() => {
            jest.resetAllMocks();
            viewManager.views = new Map();
            delete viewManager.currentView;
        });

        it('should do nothing when view is already visible or if view doesnt exist', () => {
            const view = {
                ...baseView,
                isVisible: true,
            };
            viewManager.views.set('server1-tab1', view);

            viewManager.showByName('server1-tab1');
            expect(viewManager.currentView).toBeUndefined();
            expect(view.isReady).not.toBeCalled();
            expect(view.show).not.toBeCalled();

            viewManager.showByName('some-view-name');
            expect(viewManager.currentView).toBeUndefined();
            expect(view.isReady).not.toBeCalled();
            expect(view.show).not.toBeCalled();
        });

        it('should hide current view when new view is shown', () => {
            const oldView = {
                ...baseView,
                isVisible: true,
            };
            const newView = {
                ...baseView,
                isVisible: false,
            };
            viewManager.getCurrentView.mockImplementation(() => oldView);
            viewManager.views.set('oldView', oldView);
            viewManager.views.set('newView', newView);
            viewManager.currentView = 'oldView';
            viewManager.showByName('newView');
            expect(oldView.hide).toHaveBeenCalled();
        });

        it('should not show the view when it is in error state', () => {
            const view = {...baseView};
            view.isErrored.mockReturnValue(true);
            viewManager.views.set('view1', view);
            viewManager.showByName('view1');
            expect(view.show).not.toHaveBeenCalled();
        });

        it('should show loading screen when the view needs it', () => {
            const view = {...baseView};
            view.isErrored.mockReturnValue(false);
            view.needsLoadingScreen.mockImplementation(() => true);
            viewManager.views.set('view1', view);
            viewManager.showByName('view1');
            expect(LoadingScreen.show).toHaveBeenCalled();
        });

        it('should show the view when not errored', () => {
            const view = {...baseView};
            view.needsLoadingScreen.mockImplementation(() => false);
            view.isErrored.mockReturnValue(false);
            viewManager.views.set('view1', view);
            viewManager.showByName('view1');
            expect(viewManager.currentView).toBe('view1');
            expect(view.show).toHaveBeenCalled();
        });
    });

    describe('getViewByURL', () => {
        const viewManager = new ViewManager();
        const servers = [
            {
                name: 'server-1',
                url: 'http://server-1.com',
                tabs: [
                    {
                        name: 'tab',
                    },
                    {
                        name: 'tab-type1',
                    },
                    {
                        name: 'tab-type2',
                    },
                ],
            },
            {
                name: 'server-2',
                url: 'http://server-2.com/subpath',
                tabs: [
                    {
                        name: 'tab-type1',
                    },
                    {
                        name: 'tab-type2',
                    },
                    {
                        name: 'tab',
                    },
                ],
            },
        ];
        viewManager.getServerView = (srv, tabName) => {
            const postfix = tabName.split('-')[1];
            return {
                name: `${srv.name}_${tabName}`,
                url: new URL(`${srv.url.toString().replace(/\/$/, '')}${postfix ? `/${postfix}` : ''}`),
            };
        };

        beforeEach(() => {
            Config.teams = servers.concat();
            MattermostServer.mockImplementation((server) => ({
                name: server.name,
                url: new URL(server.url),
            }));
            equalUrlsIgnoringSubpath.mockImplementation((url1, url2) => `${url1}`.startsWith(`${url2}`));
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        it('should match the correct server - base URL', () => {
            const inputURL = new URL('http://server-1.com');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-1_tab', url: new URL('http://server-1.com')});
        });

        it('should match the correct server - base tab', () => {
            const inputURL = new URL('http://server-1.com/team');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-1_tab', url: new URL('http://server-1.com')});
        });

        it('should match the correct server - different tab', () => {
            const inputURL = new URL('http://server-1.com/type1/app');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-1_tab-type1', url: new URL('http://server-1.com/type1')});
        });

        it('should return undefined for server with subpath and URL without', () => {
            const inputURL = new URL('http://server-2.com');
            expect(viewManager.getViewByURL(inputURL)).toBe(undefined);
        });

        it('should return undefined for server with subpath and URL with wrong subpath', () => {
            const inputURL = new URL('http://server-2.com/different/subpath');
            expect(viewManager.getViewByURL(inputURL)).toBe(undefined);
        });

        it('should match the correct server with a subpath - base URL', () => {
            const inputURL = new URL('http://server-2.com/subpath');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-2_tab', url: new URL('http://server-2.com/subpath')});
        });

        it('should match the correct server with a subpath - base tab', () => {
            const inputURL = new URL('http://server-2.com/subpath/team');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-2_tab', url: new URL('http://server-2.com/subpath')});
        });

        it('should match the correct server with a subpath - different tab', () => {
            const inputURL = new URL('http://server-2.com/subpath/type2/team');
            expect(viewManager.getViewByURL(inputURL)).toStrictEqual({name: 'server-2_tab-type2', url: new URL('http://server-2.com/subpath/type2')});
        });

        it('should return undefined for wrong server', () => {
            const inputURL = new URL('http://server-3.com');
            expect(viewManager.getViewByURL(inputURL)).toBe(undefined);
        });
    });

    describe('handleDeepLink', () => {
        const viewManager = new ViewManager({});
        const baseView = {
            resetLoadingStatus: jest.fn(),
            load: jest.fn(),
            once: jest.fn(),
            isInitialized: jest.fn(),
            view: {
                webContents: {
                    send: jest.fn(),
                },
            },
            serverInfo: {
                remoteInfo: {
                    serverVersion: '1.0.0',
                },
            },
        };

        beforeEach(() => {
            viewManager.openClosedTab = jest.fn();
            viewManager.getViewByURL = jest.fn();
        });

        afterEach(() => {
            jest.resetAllMocks();
            viewManager.views = new Map();
            viewManager.closedViews = new Map();
        });

        it('should load URL into matching view', () => {
            viewManager.getViewByURL.mockImplementation(() => ({name: 'view1', url: 'http://server-1.com/'}));
            const view = {...baseView};
            viewManager.views.set('view1', view);
            viewManager.handleDeepLink('mattermost://server-1.com/deep/link?thing=yes');
            expect(view.load).toHaveBeenCalledWith('http://server-1.com/deep/link?thing=yes');
        });

        it('should send the URL to the view if its already loaded on a 6.0 server', () => {
            viewManager.getViewByURL.mockImplementation(() => ({name: 'view1', url: 'http://server-1.com/'}));
            const view = {
                ...baseView,
                serverInfo: {
                    remoteInfo: {
                        serverVersion: '6.0.0',
                    },
                },
                tab: {
                    server: {
                        url: new URL('http://server-1.com'),
                    },
                },
            };
            view.isInitialized.mockImplementation(() => true);
            viewManager.views.set('view1', view);
            viewManager.handleDeepLink('mattermost://server-1.com/deep/link?thing=yes');
            expect(view.view.webContents.send).toHaveBeenCalledWith(BROWSER_HISTORY_PUSH, '/deep/link?thing=yes');
        });

        it('should throw error if view is missing', () => {
            viewManager.getViewByURL.mockImplementation(() => ({name: 'view1', url: 'http://server-1.com/'}));
            const view = {...baseView};
            viewManager.handleDeepLink('mattermost://server-1.com/deep/link?thing=yes');
            expect(view.load).not.toHaveBeenCalled();
        });

        it('should throw dialog when cannot find the view', () => {
            const view = {...baseView};
            viewManager.handleDeepLink('mattermost://server-1.com/deep/link?thing=yes');
            expect(view.load).not.toHaveBeenCalled();
            expect(dialog.showErrorBox).toHaveBeenCalled();
        });

        it('should reopen closed tab if called upon', () => {
            viewManager.getViewByURL.mockImplementation(() => ({name: 'view1', url: 'https://server-1.com/'}));
            viewManager.closedViews.set('view1', {});
            viewManager.handleDeepLink('mattermost://server-1.com/deep/link?thing=yes');
            expect(viewManager.openClosedTab).toHaveBeenCalledWith('view1', 'https://server-1.com/deep/link?thing=yes');
        });
    });
});
