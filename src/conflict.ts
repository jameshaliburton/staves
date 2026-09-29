/** A write was refused because the board changed elsewhere since it was read. Thrown by any store that
 *  checks a revision before writing — the hosted client and the hosted service alike. */
export class CloudStoreConflict extends Error {
  constructor() { super("This workflow changed elsewhere. Reload it and review your change before retrying."); this.name = "CloudStoreConflict"; }
}
