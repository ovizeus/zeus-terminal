// Zeus — core/bootstrapBrainDash.ts
//
// [2026-10-10] Intentionally empty. This file held two polling IIFEs that built HTML
// strings and wrote them into #brainVisionBody and #brainDashBody, two divs that lived in
// the Auto Trade panel. Task 3 of the institutional redesign removed those divs (both
// IIFEs already returned early when #brainVisionWrap / #brainDashWrap were absent), and
// the content now lives in React:
//   components/intel/theia/BrainVisionCard.tsx
//   components/intel/theia/BrainDashboardCard.tsx
//
// The file is kept, not deleted, only because bridge/phase1Adapters.ts still imports it
// for side effects. Removing that import is a separate, unrelated change.
export {}
