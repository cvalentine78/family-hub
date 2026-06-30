// Location quality constants, shared by every place that captures or draws a fix.

// Discard fixes less accurate than this (meters). Indoor GPS multipath and
// wifi/cell-tower fixes can be hundreds of meters off, which plots phantom
// trips to other streets/buildings. Most real GPS fixes here are < 15m, so a
// 50m gate drops the junk without losing genuine outdoor movement.
export const MAX_ACCURACY_M = 50;
