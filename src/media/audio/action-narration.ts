import type {UiOperation} from '../timeline/editing.js';
export type NarrationAction = {
    actionId: number;
    tool: string;
    targetNode?: string;
    targetContext?: string;
    submit?: boolean;
    speechText?: string;
    beforeState?: string;
    afterState?: string;
    key?: 'Escape';
    uiOperation?: UiOperation;
};
