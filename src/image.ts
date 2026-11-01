// Downscale to a JPEG data URL so images stay small enough to live inside the synced JSON files.
export async function shrink(file: File, max: number) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return { image: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }
}
