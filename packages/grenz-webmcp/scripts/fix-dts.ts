// tsc keeps the `.ts` extensions the sources use; consumers resolve `.js` against the .d.ts files.
for (const f of new Bun.Glob("dist/*.d.ts").scanSync(".")) {
  const t = await Bun.file(f).text();
  await Bun.write(f, t.replace(/(from\s+"\.[^"]*)\.tsx?"/g, '$1.js"'));
}
