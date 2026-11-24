// Lets components deep in the tree (chat chips, build cards) look up owned items and open the item panel.
import { createContext, useContext } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';

export interface InventoryApi {
  byId: Map<string, AppraisedItem>;
  select: (item: AppraisedItem) => void;
}

export const InventoryContext = createContext<InventoryApi>({ byId: new Map(), select: () => {} });
export const useInventory = () => useContext(InventoryContext);
