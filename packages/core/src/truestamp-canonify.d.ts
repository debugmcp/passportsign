// `@truestamp/canonify`'s package.json defines `exports` but doesn't expose
// types via a `"types"` condition. NodeNext module resolution can't reach
// the bundled `dist/mod.d.ts` through the exports map. Declare the surface
// locally so `tsc --noEmit` passes.
declare module '@truestamp/canonify' {
  export default function canonify(object: unknown): string | undefined;
}
