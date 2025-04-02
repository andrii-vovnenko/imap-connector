
// Function to decode Base64
export function base64ToBuffer(base64String: string): Buffer {
    try {
        return Buffer.from(base64String, 'base64');
    } catch (error) {
        console.error('Error decoding Base64:', error);
        return Buffer.from('');
    }
}

// Function to extract content type and filename
function getContentInfo(part: string) {
    const contentTypeMatch = part.match(/Content-Type:\s*([^;\r\n]+)/);
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'unknown';
    
    // Try to get filename from Content-Disposition
    let filename = null;
    const filenameMatch = part.match(/filename="([^"]+)"/);
    if (filenameMatch) {
        filename = filenameMatch[1];
    } else {
        // If no filename in Content-Disposition, try Content-Type
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
            filename = nameMatch[1];
        }
    }
    
    return { contentType, filename };
}

// Function to extract all boundaries from email
function getBoundaries(content: string) {
    const boundaries: string[] = [];
    const boundaryMatches = content.match(/boundary="([^"]+)"/g);
    if (boundaryMatches) {
        boundaryMatches.forEach(match => {
            const boundary = match.match(/boundary="([^"]+)"/)?.[1];
            if (boundary) {
                boundaries.push(boundary);
            }
        });
    }
    return boundaries;
}

// Find and decode Base64 content
export function decodeEmailParts(content: string) {
    const result: {
        html: string | null;
        text: string | null;
        attachments: { filename: string; content: Buffer }[];
    } = {
        html: content,
        text: null,
        attachments: [],
    };
    const boundaries = getBoundaries(content);
    if (boundaries.length === 0) {
        return result;
    }

    // Process each part recursively
    function processContent(content: string, boundaries: string[]) {
        if (boundaries.length === 0) return;

        const currentBoundary = boundaries[0];
        const parts = content.split('--' + currentBoundary);

        parts.forEach((part: string) => {
            if (part.trim().length === 0 || part === '--') return;

            // Check if this part contains another boundary
            if (boundaries.length > 1 && part.includes(boundaries[1])) {
                processContent(part, boundaries.slice(1));
                return;
            }

            const { contentType, filename } = getContentInfo(part);
            
            // Find Base64 content
            const base64Match = part.match(/Content-Transfer-Encoding: base64\r?\n\r?\n([\s\S]+?)(?=\r?\n--|\r?\n$|$)/);
            if (!base64Match) return;

            const base64Content = base64Match[1].replace(/[\s\r\n]/g, '');
            const decoded = base64ToBuffer(base64Content);
            // if (!decoded) return;

            if (contentType.includes('text/html')) {
                // Save HTML content
                result.html = decoded.toString('utf-8');
                // fs.writeFileSync(path.join(outputDir, 'email.html'), decoded);
                // console.log('Saved HTML content to', path.join(outputDir, 'email.html'));
            } else if (contentType.includes('text/plain')) {
                // Save plain text content
                result.text = decoded.toString('utf-8');
                // fs.writeFileSync(path.join(outputDir, 'email.txt'), decoded);
                // console.log('Saved text content to', path.join(outputDir, 'email.txt'));
            
            } else if (filename) {
                // Save attachment
                // const attachmentPath = path.join(attachmentsDir, filename);
                // fs.writeFileSync('filename.txt', decoded.toString('utf-8'));
                result.attachments.push({ filename, content: decoded });
                // console.log('Saved attachment:', filename);
            }
        });
    }

    processContent(content, boundaries);
    return result;
}
