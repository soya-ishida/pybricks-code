# Vendored pybricks wheel (Japanese docstrings)

`pybricks-3.6.0b5-py3-none-any.whl` is a repack of the wheel bundled with
`@pybricks/jedi` (which `python-worker.ts` otherwise loads). The only
difference from the original wheel is that the docstrings of the main APIs
below have been translated to plain Japanese so that the editor's signature
help and completion documentation are shown in Japanese:

- `pybricks.hubs.PrimeHub`
- `pybricks.pupdevices.Motor`, `ColorSensor`, `UltrasonicSensor`, `ForceSensor`
  (including their base classes in `pybricks._common`)
- `pybricks.robotics.DriveBase`
- `pybricks.tools.wait`, `StopWatch`

No code was changed; only docstring text. Argument names, types, and the
Google-style `Arguments:`/`Returns:` structure are identical to the original,
which `pybricks_jedi` relies on when parsing.

Regeneration scripts and the translation tables used to build this wheel are
kept in the project workspace (`wheel-work/` next to this repository).
