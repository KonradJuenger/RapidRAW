# Color Warper

Open **Color Warper** in the adjustments panel to reshape color using two Oklab chroma/lightness grids. Horizontal movement changes chroma along the plane's axis; vertical movement changes lightness. The middle columns share one neutral axis, so their lightness moves together.

- Drag a node to move it and influence nearby unlocked nodes. A directly moved node becomes a persistent anchor. Locked nodes resist movement caused by other nodes but can still be selected and moved directly.
- Ctrl/Cmd-click adds or removes nodes from the selection. Drag an empty part of a plot to select a rectangle; Ctrl/Cmd adds that rectangle to the selection.
- Hold Shift or Alt for finer movement. Escape or a cancelled pointer gesture restores the starting mesh. Releasing the pointer commits one history entry; moving back to the start commits none.
- Tab focuses nodes. Space or Enter selects the focused node, with Ctrl/Cmd for additive selection. Arrow keys nudge selected nodes; Shift/Alt makes smaller nudges. Keyboard nudges move the selected controls directly, without the pointer gesture's neighbor influence.
- Use the lock, unlock, reset-selected, reset-plane, and reset-all buttons below the plots. Resetting a plane preserves shared neutral-axis lightness; Reset All restores the entire default mesh.
- Grid density resamples existing controls. Reducing density can lose detail. Range changes the chroma span. Axis Angle rotates both chroma axes.

The background shows the plane's colors; white density points show colors entering the warper. Mesh movement does not move those input samples. Turning off the section bypasses its image effect. Lock and plot-setting changes persist in sidecars without marking an otherwise untouched image as visibly edited.

## Processing and saved state

The warper operates globally after global/masked curves and before display-referred LUTs and grain. Its input is the pipeline's display-stage sRGB/D65 encoding, converted to Oklab for deformation. The plot's background is gamut-mapped for display; image output continues through the normal pipeline gamut handling.

Defaults are a 7×7 grid, chroma range 0.2, angle 0°, pinned corners, and a pinned neutral axis. Supported grid sizes are 5, 7, 9, and 13. Saved chroma ranges must be finite and between 0.1 and 1.0; the UI offers 0.2, 0.3, and 0.4. Missing grid size/range use the defaults. Angles must be finite and are normalized modulo 360°.

The schema-2 payload records Oklab, Cartesian-volume mesh mode, smooth-trilinear interpolation, the screened-Laplacian volume solver, both planes' offsets/locks, and shared neutral-axis offsets/locks. Offset/lock arrays must match the grid size, with finite coordinates inside the editable bounds. Schema-1 four-ray controls migrate into the current volume solver in both frontend and backend paths. This retains the controls; it does not promise pixel-identical rendering with the old solver.

Unknown or malformed object payloads are preserved by the frontend as unsupported state until explicitly reset. Backend processing bypasses unsupported state. Editor, thumbnail, and headless export processing use the same parser and shader. Legacy files without a warper retain their previous output.

## Verification

Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --lib color_warper` for state, interpolation, asynchronous-result, and WGSL checks. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` checks the default Windows feature set. Tethering's all-features configuration requires a supported Linux/macOS environment.

Before release, also check human interaction in the native app, RAW files, preview/export matching, masks, crop/transform, LUTs, and the supported GPU/platform combinations. The local synthetic PNG export check is useful regression evidence but does not replace those checks.
