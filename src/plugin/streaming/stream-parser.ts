export function findRealTag(buffer: string, tag: string): number {
  const codeBlockPattern = /```[\s\S]*?```/g
  const codeBlocks: Array<[number, number]> = []

  let match: RegExpExecArray | null
  while ((match = codeBlockPattern.exec(buffer)) !== null) {
    codeBlocks.push([match.index, match.index + match[0].length])
  }

  let pos = 0
  while ((pos = buffer.indexOf(tag, pos)) !== -1) {
    let inCodeBlock = false
    for (const [start, end] of codeBlocks) {
      if (pos >= start && pos < end) {
        inCodeBlock = true
        break
      }
    }
    if (!inCodeBlock) {
      return pos
    }
    pos += tag.length
  }

  return -1
}
