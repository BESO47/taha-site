/**
 * Utilities to parse Google Drive & YouTube video URLs
 */

// Extract Google Drive File ID
export function extractGoogleDriveFileId(url) {
  if (!url) return null

  // Pattern 1: https://drive.google.com/file/d/FILE_ID/view
  const fileDMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1]

  // Pattern 2: https://drive.google.com/open?id=FILE_ID or uc?id=FILE_ID
  const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1]

  // Pattern 3: https://lh3.googleusercontent.com/d/FILE_ID
  const lh3Match = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/)
  if (lh3Match && lh3Match[1]) return lh3Match[1]

  return null
}

// Extract YouTube Video ID
export function extractYouTubeId(url) {
  if (!url) return null
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
  const match = url.match(regExp)
  return match && match[2].length === 11 ? match[2] : null
}

export function isGoogleDriveUrl(url) {
  if (!url) return false
  return (
    url.includes('drive.google.com') ||
    url.includes('googleusercontent.com') ||
    extractGoogleDriveFileId(url) !== null
  )
}

export function isYouTubeUrl(url) {
  if (!url) return false
  return (
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    extractYouTubeId(url) !== null
  )
}
