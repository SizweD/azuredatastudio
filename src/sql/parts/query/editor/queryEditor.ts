/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!sql/parts/query/editor/media/queryEditor';
import * as strings from 'vs/base/common/strings';
import * as DOM from 'vs/base/browser/dom';
import * as types from 'vs/base/common/types';

import { EditorInput, EditorOptions, IEditorControl, IEditor, TextEditorOptions } from 'vs/workbench/common/editor';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { VerticalFlexibleSash, HorizontalFlexibleSash, IFlexibleSash } from 'sql/parts/query/views/flexibleSash';
import { Orientation } from 'vs/base/browser/ui/sash/sash';

import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

import { UntitledEditorInput } from 'vs/workbench/common/editor/untitledEditorInput';
import { TextResourceEditor } from 'vs/workbench/browser/parts/editor/textResourceEditor';

import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IActionItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { ISelectionData } from 'azdata';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IRange } from 'vs/editor/common/core/range';

import { QueryResultsInput } from 'sql/parts/query/common/queryResultsInput';
import { QueryInput } from 'sql/parts/query/common/queryInput';
import { QueryResultsEditor } from 'sql/parts/query/editor/queryResultsEditor';
import * as queryContext from 'sql/parts/query/common/queryContext';
import { Taskbar, ITaskbarContent } from 'sql/base/browser/ui/taskbar/taskbar';
import {
	RunQueryAction, CancelQueryAction, ListDatabasesAction, ListDatabasesActionItem,
	ConnectDatabaseAction, ToggleConnectDatabaseAction, EstimatedQueryPlanAction,
	ActualQueryPlanAction
} from 'sql/parts/query/execution/queryActions';
import { IQueryModelService } from 'sql/platform/query/common/queryModel';
import { IEditorDescriptorService } from 'sql/workbench/services/queryEditor/common/editorDescriptorService';
import { IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';

/**
 * Editor that hosts 2 sub-editors: A TextResourceEditor for SQL file editing, and a QueryResultsEditor
 * for viewing and editing query results. This editor is based off SideBySideEditor.
 */
export class QueryEditor extends BaseEditor {

	public static ID: string = 'workbench.editor.queryEditor';

	// The height of the tabs above the editor
	private readonly _tabHeight: number = 35;

	// The minimum width/height of the editors hosted in the QueryEditor
	private readonly _minEditorSize: number = 220;

	private _sash: IFlexibleSash;
	private _editorTopOffset: number;
	private _orientation: Orientation;
	private _dimension: DOM.Dimension;

	private _resultsEditor: QueryResultsEditor;
	private _resultsEditorContainer: HTMLElement;

	private _sqlEditor: TextResourceEditor;
	private _sqlEditorContainer: HTMLElement;

	private _taskbar: Taskbar;
	private _taskbarContainer: HTMLElement;
	private _listDatabasesActionItem: ListDatabasesActionItem;


	private queryEditorVisible: IContextKey<boolean>;

	private _runQueryAction: RunQueryAction;
	private _cancelQueryAction: CancelQueryAction;
	private _toggleConnectDatabaseAction: ToggleConnectDatabaseAction;
	private _changeConnectionAction: ConnectDatabaseAction;
	private _listDatabasesAction: ListDatabasesAction;
	private _estimatedQueryPlanAction: EstimatedQueryPlanAction;
	private _actualQueryPlanAction: ActualQueryPlanAction;

	constructor(
		@ITelemetryService _telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IEditorService private _editorService: IEditorService,
		@IContextMenuService private _contextMenuService: IContextMenuService,
		@IQueryModelService private _queryModelService: IQueryModelService,
		@IEditorDescriptorService private _editorDescriptorService: IEditorDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConnectionManagementService private _connectionManagementService: IConnectionManagementService,
		@IConfigurationService private _configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService
	) {
		super(QueryEditor.ID, _telemetryService, themeService, storageService);

		this._orientation = Orientation.HORIZONTAL;

		if (contextKeyService) {
			this.queryEditorVisible = queryContext.QueryEditorVisibleContext.bindTo(contextKeyService);
		}

		if (_editorService) {
			_editorService.overrideOpenEditor((editor, options, group) => {
				if (this.isVisible() && (editor !== this.input || group !== this.group)) {
					this.saveEditorViewState();
				}
				return {};
			});
		}
	}

	// PROPERTIES //////////////////////////////////////////////////////////
	/**
	 * Returns the URI of this editor if it is connected.
	 * @returns {string} URI of the editor if connected, undefined otherwise
	 */
	public get connectedUri(): string {
		return this._connectionManagementService.isConnected(this.uri)
			? this.uri
			: undefined;
	}

	/**
	 * Returns the URI of this editor if an input is associated with it
	 * @return {string} URI of this if input is associated, undefined otherwise
	 */
	get uri(): string {
		let input: QueryInput = <QueryInput>this.input;
		return input
			? input.getQueryResultsInputResource()
			: undefined;
	}

	// PUBLIC METHODS ////////////////////////////////////////////////////////////
	public get currentQueryInput(): QueryInput {
		return <QueryInput>this.input;
	}

	/**
	 * Called to create the editor in the parent element.
	 */
	public createEditor(parent: HTMLElement): void {
		const parentElement = parent;
		DOM.addClass(parentElement, 'side-by-side-editor');
		this._createTaskbar(parentElement);
	}

	/**
	 * Sets the input data for this editor.
	 */
	public setInput(newInput: QueryInput, options?: EditorOptions): Promise<void> {
		const oldInput = <QueryInput>this.input;

		if (newInput.matches(oldInput)) {
			return Promise.resolve(undefined);
		}

		// Make sure all event callbacks will be sent to this QueryEditor in the case that this QueryInput was moved from
		// another QueryEditor
		let taskbarCallback: IDisposable = newInput.updateTaskbarEvent(() => this._updateTaskbar());
		let showResultsCallback: IDisposable = newInput.showQueryResultsEditorEvent(() => this._showQueryResultsEditor());
		let selectionCallback: IDisposable = newInput.updateSelectionEvent((selection) => this._setSelection(selection));
		newInput.setEventCallbacks([taskbarCallback, showResultsCallback, selectionCallback]);

		return super.setInput(newInput, options, CancellationToken.None)
			.then(() => this._updateInput(oldInput, newInput, options));
	}

	/**
	 * Sets this editor and the 2 sub-editors to visible.
	 */
	public setEditorVisible(visible: boolean, group: IEditorGroup): void {
		if (this._resultsEditor) {
			this._resultsEditor.setVisible(visible, group);
		}
		if (this._sqlEditor) {
			this._sqlEditor.setVisible(visible, group);
		}
		super.setEditorVisible(visible, group);

		// Note: must update after calling super.setEditorVisible so that the accurate count is handled
		this.updateQueryEditorVisible(visible);
	}


	private updateQueryEditorVisible(currentEditorIsVisible: boolean): void {
		if (this.queryEditorVisible) {
			let visible = currentEditorIsVisible;
			if (!currentEditorIsVisible) {
				// Current editor is closing but still tracked as visible. Check if any other editor is visible
				const candidates = [...this._editorService.visibleControls].filter(e => {
					if (e && e.getId) {
						return e.getId() === QueryEditor.ID;
					}
					return false;
				});
				// Note: require 2 or more candidates since current is closing but still
				// counted as visible
				visible = candidates.length > 1;
			}
			this.queryEditorVisible.set(visible);
		}
	}

	/**
	 * Called to indicate to the editor that the input should be cleared and resources associated with the
	 * input should be freed.
	 */
	public clearInput(): void {
		if (this._resultsEditor) {
			this._resultsEditor.clearInput();
		}
		if (this._sqlEditor) {
			this._sqlEditor.clearInput();
		}
		this._disposeEditors();
		super.clearInput();
	}

	/**
	 * Sets focus on this editor. Specifically, it sets the focus on the hosted text editor.
	 */
	public focus(): void {
		if (this._sqlEditor) {
			this._sqlEditor.focus();
		}
	}

	/**
	 * Updates the internal variable keeping track of the editor's size, and re-calculates the sash position.
	 * To be called when the container of this editor changes size.
	 */
	public layout(dimension: DOM.Dimension): void {
		this._dimension = dimension;

		if (this._sash) {
			this._setSashDimension();
			this.sash.layout();
		}

		this._doLayout();
		this._resizeGridContents();
	}

	/**
	 * Returns the editor control for the text editor.
	 */
	public getControl(): IEditorControl {
		if (this._sqlEditor) {
			return this._sqlEditor.getControl();
		}
		return null;
	}

	public getQueryResultsEditor(): QueryResultsEditor {
		return this._resultsEditor;
	}

	public getSqlEditor(): TextResourceEditor {
		return this._sqlEditor;
	}

	public dispose(): void {
		this._disposeEditors();
		super.dispose();
	}

	public close(): void {
		let queryInput: QueryInput = <QueryInput>this.input;
		queryInput.sql.close();
		queryInput.results.close();
	}

	/**
	 * Makes visible the QueryResultsEditor for the current QueryInput (if it is not
	 * already visible).
	 */
	public _showQueryResultsEditor(): void {
		if (this._isResultsEditorVisible()) {
			return;
		}

		const activeControl = this._editorService.activeControl;
		activeControl.group.pinEditor(activeControl.input);

		let input = <QueryInput>this.input;
		this._createResultsEditorContainer();

		this._createEditor(<QueryResultsInput>input.results, this._resultsEditorContainer, this.group)
			.then(result => {
				this._onResultsEditorCreated(<any>result, input.results, this.options);
				this.resultsEditorVisibility = true;
				this.hideQueryResultsView = false;
				this._doLayout(true);
			});
	}

	private hideQueryResultsView = false;

	/**
	 * Toggle the visibility of the view state of results
	 */
	public toggleResultsEditorVisibility(): void {
		let input = <QueryInput>this.input;
		let hideResults = this.hideQueryResultsView;
		this.hideQueryResultsView = !this.hideQueryResultsView;
		if (!input.results) {
			return;
		}
		this.resultsEditorVisibility = hideResults;
		this._doLayout();
	}

	/**
	 * Returns the underlying SQL editor's text selection in a 0-indexed format. Returns undefined if there
	 * is no selected text.
	 */
	public getSelection(checkIfRange: boolean = true): ISelectionData {
		if (this._sqlEditor && this._sqlEditor.getControl()) {
			let vscodeSelection = this._sqlEditor.getControl().getSelection();

			// If the selection is a range of characters rather than just a cursor position, return the range
			let isRange: boolean =
				!(vscodeSelection.getStartPosition().lineNumber === vscodeSelection.getEndPosition().lineNumber &&
					vscodeSelection.getStartPosition().column === vscodeSelection.getEndPosition().column);
			if (!checkIfRange || isRange) {
				let sqlToolsServiceSelection: ISelectionData = {
					startLine: vscodeSelection.getStartPosition().lineNumber - 1,
					startColumn: vscodeSelection.getStartPosition().column - 1,
					endLine: vscodeSelection.getEndPosition().lineNumber - 1,
					endColumn: vscodeSelection.getEndPosition().column - 1,
				};
				return sqlToolsServiceSelection;
			}
		}

		// Otherwise return undefined because there is no selected text
		return undefined;
	}

	public isSelectionEmpty(): boolean {
		if (this._sqlEditor && this._sqlEditor.getControl()) {
			let control = this._sqlEditor.getControl();
			let codeEditor: ICodeEditor = <ICodeEditor>control;

			if (codeEditor) {
				let value = codeEditor.getValue();
				if (value !== undefined && value.length > 0) {
					return false;
				}
			}
		}
		return true;
	}

	public getAllText(): string {
		if (this._sqlEditor && this._sqlEditor.getControl()) {
			let control = this._sqlEditor.getControl();
			let codeEditor: ICodeEditor = <ICodeEditor>control;
			if (codeEditor) {
				let value = codeEditor.getValue();
				if (value !== undefined && value.length > 0) {
					return value;
				} else {
					return '';
				}
			}
		}
		return undefined;
	}

	public getAllSelection(): ISelectionData {
		if (this._sqlEditor && this._sqlEditor.getControl()) {
			let control = this._sqlEditor.getControl();
			let codeEditor: ICodeEditor = <ICodeEditor>control;
			if (codeEditor) {
				let model = codeEditor.getModel();
				let totalLines = model.getLineCount();
				let endColumn = model.getLineMaxColumn(totalLines);
				let selection: ISelectionData = {
					startLine: 0,
					startColumn: 0,
					endLine: totalLines - 1,
					endColumn: endColumn - 1,
				};
				return selection;
			}
		}
		return undefined;
	}

	public getSelectionText(): string {
		if (this._sqlEditor && this._sqlEditor.getControl()) {
			let control = this._sqlEditor.getControl();
			let codeEditor: ICodeEditor = <ICodeEditor>control;
			let vscodeSelection = control.getSelection();

			if (codeEditor && vscodeSelection) {
				let model = codeEditor.getModel();
				let value = model.getValueInRange(vscodeSelection);
				if (value !== undefined && value.length > 0) {
					return value;
				}
			}
		}
		return '';
	}

	/**
	 * Calls the run method of this editor's RunQueryAction
	 */
	public runQuery(): void {
		this._runQueryAction.run();
	}

	/**
	 * Calls the runCurrent method of this editor's RunQueryAction
	 */
	public runCurrentQuery(): void {
		this._runQueryAction.runCurrent();
	}

	/**
	 * Calls the runCurrentQueryWithActualPlan method of this editor's ActualQueryPlanAction
	 */
	public runCurrentQueryWithActualPlan(): void {
		this._actualQueryPlanAction.run();
	}

	/**
	 * Calls the run method of this editor's CancelQueryAction
	 */
	public cancelQuery(): void {
		this._cancelQueryAction.run();
	}

	public rebuildIntelliSenseCache(): void {
		this._connectionManagementService.rebuildIntelliSenseCache(this.connectedUri);
	}

	public setOptions(options: EditorOptions): void {
		const textOptions = <TextEditorOptions>options;
		if (textOptions && types.isFunction(textOptions.apply)) {
			textOptions.apply(this.getControl() as editorCommon.IEditor, editorCommon.ScrollType.Smooth);
		}
	}

	// PRIVATE METHODS ////////////////////////////////////////////////////////////

	/**
	 * Creates the query execution taskbar that appears at the top of the QueryEditor
	 */
	private _createTaskbar(parentElement: HTMLElement): void {
		// Create QueryTaskbar
		this._taskbarContainer = DOM.append(parentElement, DOM.$('div'));
		this._taskbar = new Taskbar(this._taskbarContainer, this._contextMenuService, {
			actionItemProvider: (action: Action) => this._getActionItemForAction(action),
		});

		// Create Actions for the toolbar
		this._runQueryAction = this._instantiationService.createInstance(RunQueryAction, this);
		this._cancelQueryAction = this._instantiationService.createInstance(CancelQueryAction, this);
		this._toggleConnectDatabaseAction = this._instantiationService.createInstance(ToggleConnectDatabaseAction, this, false);
		this._changeConnectionAction = this._instantiationService.createInstance(ConnectDatabaseAction, this, true);
		this._listDatabasesAction = this._instantiationService.createInstance(ListDatabasesAction, this);
		this._estimatedQueryPlanAction = this._instantiationService.createInstance(EstimatedQueryPlanAction, this);
		this._actualQueryPlanAction = this._instantiationService.createInstance(ActualQueryPlanAction, this);

		this.setTaskbarContent();

		this._toDispose.push(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.includes('workbench.enablePreviewFeatures')) {
				this.setTaskbarContent();
			}
		}));
	}

	private setTaskbarContent(): void {
		// Create HTML Elements for the taskbar
		let separator = Taskbar.createTaskbarSeparator();

		// Set the content in the order we desire
		let content: ITaskbarContent[] = [
			{ action: this._runQueryAction },
			{ action: this._cancelQueryAction },
			{ element: separator },
			{ action: this._toggleConnectDatabaseAction },
			{ action: this._changeConnectionAction },
			{ action: this._listDatabasesAction },
			{ element: separator },
			{ action: this._estimatedQueryPlanAction }
		];

		// Remove the estimated query plan action if preview features are not enabled
		let previewFeaturesEnabled = this._configurationService.getValue('workbench')['enablePreviewFeatures'];
		if (!previewFeaturesEnabled) {
			content = content.slice(0, -2);
		}

		this._taskbar.setContent(content);
	}

	/**
	 * Gets the IActionItem for the List Databases dropdown if provided the associated Action.
	 * Otherwise returns null.
	 */
	private _getActionItemForAction(action: Action): IActionItem {
		if (action.id === ListDatabasesAction.ID) {
			return this.listDatabasesActionItem;
		}

		return null;
	}

	/**
	 * Public for testing purposes only
	 */
	public get listDatabasesActionItem(): ListDatabasesActionItem {
		if (!this._listDatabasesActionItem) {
			this._listDatabasesActionItem = this._instantiationService.createInstance(ListDatabasesActionItem, this);
			this._register(this._listDatabasesActionItem.attachStyler(this.themeService));
		}
		return this._listDatabasesActionItem;
	}

	/**
	 * Handles setting input for this editor.
	 */
	private _updateInput(oldInput: QueryInput, newInput: QueryInput, options?: EditorOptions): Promise<void> {
		if (this._sqlEditor) {
			this._sqlEditor.clearInput();
		}

		if (oldInput) {
			this._disposeEditors();
		}

		this._createSqlEditorContainer();
		if (this._isResultsEditorVisible()) {
			this._createResultsEditorContainer();

			let uri: string = newInput.getQueryResultsInputResource();
			if (uri) {
				this._queryModelService.refreshResultsets(uri);
			}
		}

		if (this._sash) {
			if (this._isResultsEditorVisible()) {
				this._sash.show();
			} else {
				this._sash.hide();
			}
		}

		this._updateTaskbar();
		return this._setNewInput(newInput, options);
	}

	/**
	 * Handles setting input and creating editors when this QueryEditor is either:
	 * - Opened for the first time
	 * - Opened with a new QueryInput
	 * This will create only the SQL editor if the results editor does not yet exist for the
	 * given QueryInput.
	 */
	private _setNewInput(newInput: QueryInput, options?: EditorOptions): Promise<any> {

		// Promises that will ensure proper ordering of editor creation logic
		let createEditors: () => Promise<any>;
		let onEditorsCreated: (result) => Promise<any>;

		// If both editors exist, create joined promises - one for each editor
		if (this._isResultsEditorVisible()) {
			createEditors = () => {
				return Promise.all([
					this._createEditor(<QueryResultsInput>newInput.results, this._resultsEditorContainer, this.group),
					this._createEditor(<UntitledEditorInput>newInput.sql, this._sqlEditorContainer, this.group)
				]);
			};
			onEditorsCreated = (result: IEditor[]) => {
				return Promise.all([
					this._onResultsEditorCreated(<QueryResultsEditor>result[0], newInput.results, options),
					this._onSqlEditorCreated(<TextResourceEditor>result[1], newInput.sql, options)
				]);
			};

			// If only the sql editor exists, create a promise and wait for the sql editor to be created
		} else {
			createEditors = () => {
				return this._createEditor(<UntitledEditorInput>newInput.sql, this._sqlEditorContainer, this.group);
			};
			onEditorsCreated = (result: TextResourceEditor) => {
				return Promise.all([
					this._onSqlEditorCreated(result, newInput.sql, options)
				]);
			};
		}

		// Create a promise to re render the layout after the editor creation logic
		let doLayout: () => Promise<any> = () => {
			this._doLayout();
			return Promise.resolve(undefined);
		};

		// Run all three steps synchronously
		return createEditors()
			.then(onEditorsCreated)
			.then(doLayout)
			.then(() => {
				if (newInput.results) {
					newInput.results.onRestoreViewStateEmitter.fire();
				}
				if (newInput.savedViewState) {
					this._sqlEditor.getControl().restoreViewState(newInput.savedViewState);
				}
			});
	}

	/**
	 * Create a single editor based on the type of the given EditorInput.
	 */
	private _createEditor(editorInput: EditorInput, container: HTMLElement, group: IEditorGroup): Promise<BaseEditor> {
		const descriptor = this._editorDescriptorService.getEditor(editorInput);
		if (!descriptor) {
			return Promise.reject(new Error(strings.format('Can not find a registered editor for the input {0}', editorInput)));
		}

		let editor = descriptor.instantiate(this._instantiationService);
		editor.create(container);
		editor.setVisible(this.isVisible(), group);
		return Promise.resolve(editor);
	}

	/**
	 * Sets input for the SQL editor after it has been created.
	 */
	private _onSqlEditorCreated(sqlEditor: TextResourceEditor, sqlInput: UntitledEditorInput, options: EditorOptions): Thenable<void> {
		this._sqlEditor = sqlEditor;
		return this._sqlEditor.setInput(sqlInput, options, CancellationToken.None);
	}

	/**
	 * Sets input for the results editor after it has been created.
	 */
	private _onResultsEditorCreated(resultsEditor: QueryResultsEditor, resultsInput: QueryResultsInput, options: EditorOptions): Promise<void> {
		this._resultsEditor = resultsEditor;
		return this._resultsEditor.setInput(resultsInput, options);
	}

	/**
	 * Appends the HTML for the SQL editor. Creates new HTML every time.
	 */
	private _createSqlEditorContainer() {
		const parentElement = this.getContainer();
		this._sqlEditorContainer = DOM.append(parentElement, DOM.$('.details-editor-container'));
		this._sqlEditorContainer.style.position = 'absolute';
	}

	/**
	 * Appends the HTML for the QueryResultsEditor to the QueryEditor. If the HTML has not yet been
	 * created, it creates it and appends it. If it has already been created, it locates it and
	 * appends it.
	 */
	private _createResultsEditorContainer() {
		this._createSash();

		const parentElement = this.getContainer();
		let input = <QueryInput>this.input;

		if (!input.results.container) {
			let cssClass: string = '.master-editor-container';
			if (this._orientation === Orientation.HORIZONTAL) {
				cssClass = '.master-editor-container-horizontal';
			}

			this._resultsEditorContainer = DOM.append(parentElement, DOM.$(cssClass));
			this._resultsEditorContainer.style.position = 'absolute';

			input.results.container = this._resultsEditorContainer;
		} else {
			this._resultsEditorContainer = DOM.append(parentElement, input.results.container);
		}
	}

	/**
	 * Creates the sash with the requested orientation and registers sash callbacks
	 */
	private _createSash(): void {
		if (!this._sash) {
			let parentElement: HTMLElement = this.getContainer();

			if (this._orientation === Orientation.HORIZONTAL) {
				this._sash = this._register(new HorizontalFlexibleSash(parentElement, this._minEditorSize));
			} else {
				this._sash = this._register(new VerticalFlexibleSash(parentElement, this._minEditorSize));
				this._sash.setEdge(this.getTaskBarHeight() + this._tabHeight);
			}
			this._setSashDimension();

			this._register(this._sash.onPositionChange(position => this._doLayout()));
		}

		this.sash.show();
	}

	private _setSashDimension(): void {
		if (!this._dimension) {
			return;
		}
		if (this._orientation === Orientation.HORIZONTAL) {
			this._sash.setDimenesion(this._dimension);
		} else {
			this._sash.setDimenesion(new DOM.Dimension(this._dimension.width, this._dimension.height - this.getTaskBarHeight()));
		}

	}

	/**
	 * Updates the size of the 2 sub-editors. Uses agnostic dimensions due to the fact that
	 * the IFlexibleSash could be horizontal or vertical. The same logic is used for horizontal
	 * and vertical sashes.
	 */
	private _doLayout(skipResizeGridContent: boolean = false): void {
		if (!this._isResultsEditorVisible() && this._sqlEditor) {
			this._doLayoutSql();
			return;
		}
		if (!this._sqlEditor || !this._resultsEditor || !this._dimension || !this._sash) {
			return;
		}

		if (this._orientation === Orientation.HORIZONTAL) {
			this._doLayoutHorizontal();
		} else {
			this._doLayoutVertical();
		}

		if (!skipResizeGridContent) {
			this._resizeGridContents();
		}
	}

	private getTaskBarHeight(): number {
		let taskBarElement = this.taskbar.getContainer().getHTMLElement();
		return DOM.getContentHeight(taskBarElement);
	}

	private _doLayoutHorizontal(): void {
		let splitPointTop: number = this._sash.getSplitPoint();
		let parent: ClientRect = this.getContainer().getBoundingClientRect();

		let sqlEditorHeight = splitPointTop - (parent.top + this.getTaskBarHeight());

		let titleBar = document.getElementById('workbench.parts.titlebar');
		if (titleBar) {
			sqlEditorHeight += DOM.getContentHeight(titleBar);
		}

		let queryResultsEditorHeight = parent.bottom - splitPointTop;
		this._resultsEditorContainer.hidden = false;
		this._sqlEditorContainer.style.height = `${sqlEditorHeight}px`;
		this._sqlEditorContainer.style.width = `${this._dimension.width}px`;
		this._sqlEditorContainer.style.top = `${this._editorTopOffset}px`;

		this._resultsEditorContainer.style.height = `${queryResultsEditorHeight}px`;
		this._resultsEditorContainer.style.width = `${this._dimension.width}px`;
		this._resultsEditorContainer.style.top = `${splitPointTop}px`;

		this._sqlEditor.layout(new DOM.Dimension(this._dimension.width, sqlEditorHeight));
		this._resultsEditor.layout(new DOM.Dimension(this._dimension.width, queryResultsEditorHeight));
	}

	private _doLayoutVertical(): void {
		let splitPointLeft: number = this._sash.getSplitPoint();
		let parent: ClientRect = this.getContainer().getBoundingClientRect();

		let sqlEditorWidth = splitPointLeft;
		let queryResultsEditorWidth = parent.width - splitPointLeft;

		let taskbarHeight = this.getTaskBarHeight();
		this._sqlEditorContainer.style.width = `${sqlEditorWidth}px`;
		this._sqlEditorContainer.style.height = `${this._dimension.height - taskbarHeight}px`;
		this._sqlEditorContainer.style.left = `0px`;

		this._resultsEditorContainer.hidden = false;
		this._resultsEditorContainer.style.width = `${queryResultsEditorWidth}px`;
		this._resultsEditorContainer.style.height = `${this._dimension.height - taskbarHeight}px`;
		this._resultsEditorContainer.style.left = `${splitPointLeft}px`;

		this._sqlEditor.layout(new DOM.Dimension(sqlEditorWidth, this._dimension.height - taskbarHeight));
		this._resultsEditor.layout(new DOM.Dimension(queryResultsEditorWidth, this._dimension.height - taskbarHeight));
	}

	private _doLayoutSql() {
		if (this._resultsEditorContainer) {
			this._resultsEditorContainer.style.width = '0px';
			this._resultsEditorContainer.style.height = '0px';
			this._resultsEditorContainer.style.left = '0px';
			this._resultsEditorContainer.hidden = true;
		}

		if (this._dimension) {
			this._sqlEditor.layout(new DOM.Dimension(this._dimension.width, this._dimension.height - this.getTaskBarHeight()));
		}
	}

	private _resizeGridContents(): void {
		if (this._isResultsEditorVisible()) {
			let queryInput: QueryInput = <QueryInput>this.input;
			let uri: string = queryInput.getQueryResultsInputResource();
			if (uri) {
				this._queryModelService.resizeResultsets(uri);
			}
		}
	}

	private _disposeEditors(): void {
		if (this._sqlEditor) {
			this._sqlEditor.dispose();
			this._sqlEditor = null;
		}
		if (this._resultsEditor) {
			this._resultsEditor.dispose();
			this._resultsEditor = null;
		}

		let thisEditorParent: HTMLElement = this.getContainer();

		if (this._sqlEditorContainer) {
			let sqlEditorParent: HTMLElement = this._sqlEditorContainer.parentElement;
			if (sqlEditorParent && sqlEditorParent === thisEditorParent) {
				this._sqlEditorContainer.parentElement.removeChild(this._sqlEditorContainer);
			}
			this._sqlEditorContainer = null;
		}

		if (this._resultsEditorContainer) {
			let resultsEditorParent: HTMLElement = this._resultsEditorContainer.parentElement;
			if (resultsEditorParent && resultsEditorParent === thisEditorParent) {
				this._resultsEditorContainer.parentElement.removeChild(this._resultsEditorContainer);
			}
			this._resultsEditorContainer = null;
			this.hideQueryResultsView = false;
		}
	}

	/**
	 * Returns true if the QueryResultsInput has denoted that the results editor
	 * should be visible.
	 * Public for testing only.
	 */
	public _isResultsEditorVisible(): boolean {
		let input: QueryInput = <QueryInput>this.input;

		if (!input) {
			return false;
		}
		return input.results.visible;
	}

	set resultsEditorVisibility(isVisible: boolean) {
		let input: QueryInput = <QueryInput>this.input;
		input.results.visible = isVisible;
	}

	/**
	 * Update the buttons on the taskbar to reflect the state of the current input.
	 */
	private _updateTaskbar(): void {
		let queryInput: QueryInput = <QueryInput>this.input;

		if (queryInput) {
			this._cancelQueryAction.enabled = queryInput.cancelQueryEnabled;
			this._changeConnectionAction.enabled = queryInput.changeConnectionEnabled;

			// For the toggle database action, it should always be enabled since it's a toggle.
			// We use inverse of connect enabled state for now, should refactor queryInput in the future to
			// define connected as a boolean instead of using the enabled flag
			this._toggleConnectDatabaseAction.enabled = true;
			this._toggleConnectDatabaseAction.connected = !queryInput.connectEnabled;
			this._runQueryAction.enabled = queryInput.runQueryEnabled;
			if (queryInput.listDatabasesConnected) {
				this.listDatabasesActionItem.onConnected();
			} else {
				this.listDatabasesActionItem.onDisconnect();
			}
		}
	}

	/**
	 * Sets the text selection for the SQL editor based on the given ISelectionData.
	 */
	private _setSelection(selection: ISelectionData): void {
		let rangeConversion: IRange = {
			startLineNumber: selection.startLine + 1,
			startColumn: selection.startColumn + 1,
			endLineNumber: selection.endLine + 1,
			endColumn: selection.endColumn + 1
		};
		let editor = this._sqlEditor.getControl();
		editor.revealRange(rangeConversion);
		editor.setSelection(rangeConversion);
		editor.focus();
	}

	private saveEditorViewState(): void {
		let queryInput = this.input as QueryInput;
		if (queryInput) {
			if (this._sqlEditor) {
				queryInput.savedViewState = this._sqlEditor.getControl().saveViewState();
			}
			if (queryInput.results) {
				queryInput.results.onSaveViewStateEmitter.fire();
			}
		}
	}

	// TESTING PROPERTIES ////////////////////////////////////////////////////////////

	public get resultsEditor(): QueryResultsEditor {
		return this._resultsEditor;
	}

	public get sqlEditor(): TextResourceEditor {
		return this._sqlEditor;
	}

	public get taskbar(): Taskbar {
		return this._taskbar;
	}

	public get sash(): IFlexibleSash {
		return this._sash;
	}

	public get resultsEditorContainer(): HTMLElement {
		return this._resultsEditorContainer;
	}

	public get sqlEditorContainer(): HTMLElement {
		return this._sqlEditorContainer;
	}

	public get taskbarContainer(): HTMLElement {
		return this._taskbarContainer;
	}

	public get runQueryAction(): RunQueryAction {
		return this._runQueryAction;
	}

	public get cancelQueryAction(): CancelQueryAction {
		return this._cancelQueryAction;
	}

	public get changeConnectionAction(): ConnectDatabaseAction {
		return this._changeConnectionAction;
	}

	public registerQueryModelViewTab(title: string, componentId: string): void {
		this._resultsEditor.registerQueryModelViewTab(title, componentId);
	}
}
