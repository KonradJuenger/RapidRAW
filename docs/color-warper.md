# Color Warper

Open **Color Warper** in the adjustments panel to reshape color using two Oklab chroma/lightness grids. Horizontal movement changes chroma along the plane's axis; vertical movement changes lightness. The middle columns share one neutral axis, so their lightness moves together.

- Drag a node to move it and influence nearby unlocked nodes. A directly moved node becomes a persistent anchor. Locked nodes resist movement caused by other nodes but can still be selected and moved directly.
- Ctrl/Cmd-click adds or removes nodes from the selection. Drag an empty part of a plot to select a rectangle; Ctrl/Cmd adds that rectangle to the selection.
- Hold Shift or Alt for finer movement. Escape or a cancelled pointer gesture restores the starting mesh. Releasing the pointer commits one history entry; moving back to the start commits none.
- Tab focuses nodes. Space or Enter selects the focused node, with Ctrl/Cmd for additive selection. Arrow keys nudge selected nodes; Shift/Alt makes smaller nudges. Keyboard nudges move the selected controls directly, without the pointer gesture's neighbor influence.
- Use the lock, unlock, reset-selected, reset-plane, and reset-all buttons below the plots. Resetting a plane preserves shared neutral-axis lightness; Reset All restores the entire default mesh.
- Grid density resamples existing controls. Reducing density can lose detail. Range changes the chroma span. Axis Angle rotates both chroma axes.

The background shows the plane's colors; white density points show colors entering the warper. Mesh movement does not move those input samples. Turning off the section bypasses its image effect. Lock and plot-setting changes persist in sidecars without marking an otherwise untouched image as visibly edited.

## Polar and Linked Views

The Mode selector offers the original grid, **Polar · Hue / Saturation**, and **Linked Views · Hue / Chroma / Lightness**. Polar and Linked Views share a hue/chroma mesh; switching to Polar temporarily bypasses the linked lightness edits without deleting them. Grid edits are retained separately.

The wheel uses OKLCH: angle changes hue and radius changes chroma, across all lightness levels. Spokes (6–24) and rings (3–12) can be resampled independently. Reducing density can lose detail. Double-click a point to reset it; arrow keys nudge it. Escape cancels a drag.

In Linked Views, an amber dashed spoke selects the Lightness Slice independently of normal point selection. Alt-click a wheel point, use the previous/next buttons, or press [ / ] while the wheel is focused. The highlighted polyline follows wheel deformation, while the slice remains attached to the same original colors.

The slice unfolds source ring order horizontally and shows lightness vertically. Its seven lightness levels have **vertical-only** editable controls: Up/Down nudges lightness, Shift reduces the step, and double-click/Delete resets a point subject to its neighbors. Black, white, and the shared neutral axis remain fixed. Each point is constrained between neighboring lightness levels to preserve tonal order. Hue/chroma edits update the slice geometry and colors; hover links corresponding controls. Reset lightness affects all slices; Reset polar affects only hue/chroma.

Linked lightness offsets are stored by original lightness layer, ring and spoke. The GPU interpolates in original hue/chroma coordinates with periodic hue and a fixed neutral center; it interpolates linearly between lightness layers. It applies hue/chroma and lightness together in OKLab before returning to the image pipeline. Missing lightness arrays in older polar states mean identity.

## Processing and saved state

The warper operates globally after global/masked curves and before display-referred LUTs and grain. Its input is the pipeline's display-stage sRGB/D65 encoding, converted to Oklab for deformation. The plot's background is gamut-mapped for display; image output continues through the normal pipeline gamut handling.

Defaults are a 7×7 grid, chroma range 0.2, angle 0°, pinned corners, and a pinned neutral axis. Supported grid sizes are 5, 7, 9, and 13. Saved chroma ranges must be finite and between 0.1 and 1.0; the UI offers 0.2, 0.3, and 0.4. Missing grid size/range use the defaults. Angles must be finite and are normalized modulo 360°.

The schema-2 payload records Oklab, Cartesian-volume mesh mode, smooth-trilinear interpolation, the screened-Laplacian volume solver, both planes' offsets/locks, and shared neutral-axis offsets/locks. Offset/lock arrays must match the grid size, with finite coordinates inside the editable bounds. Schema-1 four-ray controls migrate into the current volume solver in both frontend and backend paths. This retains the controls; it does not promise pixel-identical rendering with the old solver.

Unknown or malformed object payloads are preserved by the frontend as unsupported state until explicitly reset. Backend processing bypasses unsupported state. Editor, thumbnail, and headless export processing use the same parser and shader. Legacy files without a warper retain their previous output.

## Verification

Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --lib color_warper` for state, interpolation, asynchronous-result, and WGSL checks. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` checks the default Windows feature set. Tethering's all-features configuration requires a supported Linux/macOS environment.

Before release, also check human interaction in the native app, RAW files, preview/export matching, masks, crop/transform, LUTs, and the supported GPU/platform combinations. The local synthetic PNG export check is useful regression evidence but does not replace those checks.

## Linked Views polish

The slice is unfolded along source ring order, so a spoke can bend or double back without overlapping slice columns. Its background samples the same smooth hue/chroma mapping as the image shader, then converts OKLab colors for display; there are no per-column RGB bands. Vertical coordinates represent output lightness.

Grid angle is a slider with a reset and an outer wheel handle. Alignment resamples the existing hue/chroma and lightness deformation at new source angles; arbitrary rotations may soften fine edits at finite mesh density. A whole-spoke rotation preserves the mapping. Slider and handle drags resample from their starting mesh, avoiding cumulative loss within the gesture.

The selected spoke has a simple amber dashed line, with small clickable rim markers. There are no on-canvas numbers or dark path outlines. Shift enables fine movement in both views. A change readout shows hue/chroma/lightness deltas. Hold to compare uses the temporary preview override and does not write bypass settings into the adjustment history or sidecar.

Present colors are actual stratified image samples, stored as OKLab triples (up to 65,536 points across the visible image). Both plots project these same source points at subpixel positions as small dots. The slice filters them around its selected source hue; the wheel projects a/b. Image-color dots are always visible with overlay opacity fixed at 85%. No histogram bitmap is stretched over the polar or slice plot.

The wheel and slice are separated by only a 4px gap. Rim dots select the source spoke independently of point selection. Drag empty space in either plot to marquee-select controls at their deformed positions. Ctrl/Cmd-drag adds to the existing selection; an empty click clears it and Escape cancels without changing the selection or adjustment history. Pinned neutral controls and fixed slice endpoints are excluded. Ctrl/Cmd-click selects multiple controls. Pins resist propagated edits but can be moved directly, matching the CL grid; direct edits pin their targets. Neutral controls start pinned and share a single center and lightness spine. Unpin neutrals to edit them. Polar drag influence uses a linear radial falloff from the selected point toward the center and edge, stopped by nearer pins. Adjacent spokes remain fixed as angular boundaries; the existing color interpolation fades the edit between them. Moving an unpinned neutral center applies radial falloff on all spokes. Slice influence also spreads to neighboring spokes and limits the total step to preserve lightness order. Pull together moves selected controls halfway toward their centroid and propagates the displacement to unpinned neighbors. Separate reset buttons clear hue, chroma, or lightness throughout the polar mesh.

Linked slice backgrounds use a 96×72 preview texture, smoothly scaled to the plot area. This reduces display-only gamut conversions; mesh controls, density samples, and image processing retain full precision. The wheel retains its dot canvas across angle, spoke-count, and mesh changes. It redraws for new sample arrays, chroma range, or canvas size/device pixel ratio changes.

The Lightness spread dropdown controls subsequent slice drags, keyboard moves, and pull-together operations. All retains the original angular falloff. Numbered options use symmetric reach: 1 affects the selected spoke only; 2 includes one neighbor on each side; 3 includes two, and so on up to half the spoke count. The influence tapers linearly to zero at that reach and still respects pins. Shared neutral-spine edits remain shared across hues. The setting is saved as polar.sliceSpread and clamped when reducing the number of spokes; changing it does not rewrite existing offsets.
