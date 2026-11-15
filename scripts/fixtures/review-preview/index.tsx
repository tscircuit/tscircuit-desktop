export default function VoltageDivider() {
  return (
    <board width="18mm" height="12mm">
      <schematicsheet name="divider-sheet" displayName="Voltage divider" />
      <pinheader
        name="J1"
        schSheetName="divider-sheet"
        pinCount={3}
        pitch="2.54mm"
        pinLabels={["VIN", "VOUT", "GND"]}
        pcbY={-3}
        schX={-4}
      />
      <resistor
        name="R1"
        schSheetName="divider-sheet"
        resistance="10k"
        footprint="0603"
        pcbX={-2}
        pcbY={2}
        schX={1}
        schY={2}
        schRotation={-90}
      />
      <resistor
        name="R2"
        schSheetName="divider-sheet"
        resistance="10k"
        footprint="0603"
        pcbX={2}
        pcbY={2}
        schX={1}
        schY={-2}
        schRotation={-90}
      />
      <trace name="vin" from=".J1 > .pin1" to=".R1 > .pin1" />
      <trace name="divider" from=".R1 > .pin2" to=".R2 > .pin1" />
      <trace name="vout" from=".J1 > .pin2" to=".R2 > .pin1" />
      <trace name="ground" from=".J1 > .pin3" to=".R2 > .pin2" />
    </board>
  )
}
