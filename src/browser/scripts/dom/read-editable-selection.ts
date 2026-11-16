import editableSelectionState from './editable-selection-state.js';
import editableTextMatches from './editable-text-matches.js';
export default function readEditableSelection(el: HTMLElement) {
    return editableSelectionState(el, editableTextMatches);
}
