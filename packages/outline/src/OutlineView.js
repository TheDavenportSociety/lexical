// @flow strict

import type {RootNode} from './OutlineRootNode';
import type {OutlineEditor} from './OutlineEditor';
import {createSelection, Selection} from './OutlineSelection';
import type {Node, NodeKey} from './OutlineNode';

import {reconcileViewModel} from './OutlineReconciler';
import {getSelection} from './OutlineSelection';
import {getNodeByKey} from './OutlineNode';
import {TextNode} from '.';
import {invariant} from './OutlineUtils';

export type ViewType = {
  getRoot: () => RootNode,
  getNodeByKey: (key: NodeKey) => null | Node,
  getSelection: () => null | Selection,
  setSelection: (selection: Selection) => void,
};

export type NodeMapType = {[key: NodeKey]: Node};

let activeViewModel = null;
let activeReadyOnlyMode = false;

export function shouldErrorOnReadOnly(): void {
  invariant(!activeReadyOnlyMode, 'Cannot use method in read-only mode.');
}

export function getActiveViewModel(): ViewModel {
  if (activeViewModel === null) {
    throw new Error(
      'Unable to find an active view model. ' +
        'Editor helpers or node methods can only be used ' +
        'synchronously during the callback of editor.draft().',
    );
  }
  return activeViewModel;
}

const view: ViewType = {
  getRoot() {
    return getActiveViewModel().root;
  },
  getNodeByKey,
  getSelection,
  setSelection(selection: Selection): void {
    const viewModel = getActiveViewModel();
    viewModel.selection = selection;
  },
};

export function draftViewModel(
  currentViewModel: ViewModel,
  callbackFn: (view: ViewType) => void,
  editor: OutlineEditor,
): ViewModel {
  const hasActiveViewModel = activeViewModel !== null;
  const viewModel: ViewModel = hasActiveViewModel
    ? getActiveViewModel()
    : cloneViewModel(currentViewModel);
  viewModel.selection = createSelection(viewModel, editor);
  callCallbackWithViewModelScope(
    (v: ViewType) => {
      callbackFn(v);
      if (viewModel.hasDirtyNodes()) {
        applyTextTransforms(viewModel, editor);
        garbageCollectDetachedNodes(viewModel);
      }
    },
    viewModel,
    editor,
    false,
  );

  const canUseExistingModel =
    !viewModel.hasDirtyNodes() &&
    !viewModelHasDirtySelection(viewModel, editor);
  return canUseExistingModel ? currentViewModel : viewModel;
}

function viewModelHasDirtySelection(
  viewModel: ViewModel,
  editor: OutlineEditor,
): boolean {
  const selection = viewModel.selection;
  const currentSelection = editor.getCurrentViewModel().selection;
  if (
    (currentSelection !== null && selection === null) ||
    (currentSelection === null && selection !== null)
  ) {
    return true;
  }

  return selection !== null && selection.isDirty;
}

export function readViewModel(
  viewModel: ViewModel,
  callbackFn: (view: ViewType) => void,
  editor: OutlineEditor,
) {
  callCallbackWithViewModelScope(callbackFn, viewModel, editor, true);
}

function callCallbackWithViewModelScope(
  callbackFn: (view: ViewType) => void,
  viewModel: ViewModel,
  editor: OutlineEditor,
  readOnly: boolean,
): void {
  const previousActiveViewModel = activeViewModel;
  const previousReadyOnlyMode = activeReadyOnlyMode;
  activeViewModel = viewModel;
  activeReadyOnlyMode = readOnly;
  callbackFn(view);
  activeViewModel = previousActiveViewModel;
  activeReadyOnlyMode = previousReadyOnlyMode;
}

// To optimize things, we only apply transforms to
// dirty text nodes, rather than all text nodes.
export function applyTextTransforms(
  viewModel: ViewModel,
  editor: OutlineEditor,
): void {
  const textTransformsSet = editor._textTransforms;
  if (textTransformsSet.size > 0) {
    const nodeMap = viewModel.nodeMap;
    const dirtyNodes = Array.from(viewModel.dirtyNodes);
    const textTransforms = Array.from(textTransformsSet);

    for (let s = 0; s < dirtyNodes.length; s++) {
      const nodeKey = dirtyNodes[s];
      const node = nodeMap[nodeKey];

      if (node !== undefined && node.isAttached()) {
        // Apply text transforms
        if (node instanceof TextNode) {
          for (let i = 0; i < textTransforms.length; i++) {
            textTransforms[i](node, view);
          }
        }
      }
    }
  }
}

export function garbageCollectDetachedNodes(viewModel: ViewModel): void {
  const dirtyNodes = Array.from(viewModel.dirtyNodes);
  const nodeMap = viewModel.nodeMap;

  for (let s = 0; s < dirtyNodes.length; s++) {
    const nodeKey = dirtyNodes[s];
    const node = nodeMap[nodeKey];

    if (node !== undefined && !node.isAttached()) {
      // Garbage collect node
      delete nodeMap[nodeKey];
    }
  }
}

export function updateViewModel(
  viewModel: ViewModel,
  editor: OutlineEditor,
): void {
  const previousActiveViewModel = activeViewModel;
  activeViewModel = viewModel;
  reconcileViewModel(viewModel, editor);
  activeViewModel = previousActiveViewModel;
  editor._viewModel = viewModel;
  triggerOnChange(editor, viewModel);
}

export function triggerOnChange(
  editor: OutlineEditor,
  viewModel: ViewModel,
): void {
  const listeners = Array.from(editor._updateListeners);
  for (let i = 0; i < listeners.length; i++) {
    listeners[i](viewModel);
  }
}

export function cloneViewModel(current: ViewModel): ViewModel {
  const draft = new ViewModel(current.root);
  draft.nodeMap = {...current.nodeMap};
  return draft;
}

export class ViewModel {
  root: RootNode;
  nodeMap: NodeMapType;
  selection: null | Selection;
  dirtyNodes: Set<NodeKey>;
  dirtySubTrees: Set<NodeKey>;
  isHistoric: boolean;

  constructor(root: RootNode) {
    this.root = root;
    this.nodeMap = {};
    this.selection = null;
    // Dirty nodes are nodes that have been added or updated
    // in comparison to the previous view model. We also use
    // this Set for performance optimizations during the
    // production of a draft view model and during undo/redo.
    this.dirtyNodes = new Set();
    // We make nodes as "dirty" in that their have a child
    // that is dirty, which means we need to reconcile
    // the given sub-tree to find the dirty node.
    this.dirtySubTrees = new Set();
    // Used for undo/redo logic
    this.isHistoric = false;
  }
  hasDirtyNodes(): boolean {
    return this.dirtyNodes.size > 0;
  }
  getDirtyNodes(): Array<Node> {
    const dirtyNodes = Array.from(this.dirtyNodes);
    const nodeMap = this.nodeMap;
    const nodes = [];

    for (let i = 0; i < dirtyNodes.length; i++) {
      const dirtyNodeKey = dirtyNodes[i];
      const dirtyNode = nodeMap[dirtyNodeKey];

      if (dirtyNode !== undefined) {
        nodes.push(dirtyNode);
      }
    }
    return nodes;
  }
}
