// One hovercard for the whole app, shared through context so every tile can drive it
// without threading props through each list.
import { createContext, useContext } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';

export interface HoverApi {
  enter: (item: AppraisedItem, anchor: DOMRect) => void;
  leave: () => void;
}

export const HoverContext = createContext<HoverApi | null>(null);
export const useHover = () => useContext(HoverContext);
