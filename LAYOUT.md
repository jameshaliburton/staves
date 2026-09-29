# Layout rules

Every number lives in `src/layout.ts`. The renderer is not allowed to invent one.

**R1 · Nothing draws outside its box.** Every string is measured; if it does not fit the space it has, it is cut at a word with an ellipsis. Titles fit the clip minus its padding and its gate reserve; meta lines the same; track names fit the label column; artifact labels fit their column plus the gutter. No overflow, ever.

**R2 · Clips are measured, columns are sized.** A clip is as wide as its widest line plus padding (plus a reserve if it has notches), never narrower than the column minimum. A column is as wide as its widest clip. The board is as wide as its columns and their gutters. Wide is fine; cramped is not.

**R3 · Columns are handoffs.** A clip sits in the column after the last handoff it takes. Loops do not count. Two clips on one track in one column stack with a fixed offset and never overlap.

**R4 · Tracks have one height.** A clip with a meta line is 44 high, a title-only clip 30, both centred in the 64 track. Track backgrounds start one inset left of the first column line and run the full board width.

**R5 · Marks are a row.** Draft ring, loop, and any future mark sit in one row above the clip's right edge, evenly stepped; the pin is last and outermost. Nothing sits beside a clip.

**R6 · Notes are not on the board.** A finding is a numbered pin on its clip; its text is in the gutter under the board, in pin order, wrapped to a fixed measure. Exit labels are not drawn; a gate shows one notch per exit, bistre when the exit has no target.

**R7 · Wires.** Leave from the right port, arrive at the left port, cubic between. A handoff to an earlier column, or a loop, drops under both clips. A handoff within one column is a straight vertical. A wire into a job a person gets to is dashed; a wire out of a gate is the admitted green.

**R8 · Type.** One family, Archivo, embedded. Titles 12.5/600, meta 10.5/400, track names 12.5/600, notes 10.5. No labels above things that are already legible. No uppercase tracked eyebrows.

**R9 · Gutters and margins.** Column gutter 36, track gap 8, page margin 40, header 40 for artifact labels, gutter-top 28 before the notes. These are the only spacing values; if a layout needs another, it is added to `layout.ts` with a name.
