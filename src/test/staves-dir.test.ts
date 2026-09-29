import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findStavesDir } from "../store.js";

const temp = async () => await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "staves-dir-"));

test('the search for .staves stops at the repository it started in',async()=>{
 const root=await temp();
 await fs.mkdir(path.join(root,'.staves'),{recursive:true});
 await fs.mkdir(path.join(root,'.git'),{recursive:true});
 assert.equal(findStavesDir(root),path.join(root,'.staves'),'the repository that owns .staves still finds it');
 assert.equal(findStavesDir(path.join(root,'src')),path.join(root,'.staves'),'a plain subdirectory still walks up to it');

 // A worktree checked out inside the parent: .git is a file, and the parent's boards are not its own.
 const worktree=path.join(root,'.worktrees','agent');
 await fs.mkdir(path.join(worktree,'src'),{recursive:true});
 await fs.writeFile(path.join(worktree,'.git'),`gitdir: ${path.join(root,'.git','worktrees','agent')}\n`);
 assert.equal(findStavesDir(worktree),path.join(worktree,'.staves'),'the worktree claims its own .staves, not the parent\'s');
 assert.equal(findStavesDir(path.join(worktree,'src')),path.join(path.join(worktree,'src'),'.staves'),'nor does a directory inside it cross the boundary');

 // A nested checkout with its own boards keeps them.
 await fs.mkdir(path.join(worktree,'.staves'),{recursive:true});
 assert.equal(findStavesDir(path.join(worktree,'src')),path.join(worktree,'.staves'));
 await fs.rm(root,{recursive:true,force:true});
});

test('a directory under no repository at all still walks to the top',async()=>{
 const root=await temp();
 await fs.mkdir(path.join(root,'a','b'),{recursive:true});
 await fs.mkdir(path.join(root,'.staves'),{recursive:true});
 assert.equal(findStavesDir(path.join(root,'a','b')),path.join(root,'.staves'));
 await fs.rm(root,{recursive:true,force:true});
});
