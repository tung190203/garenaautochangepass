const fs = require('fs');
const zlib = require('zlib');

// Create a 256x256 transparent PNG
const width = 256;
const height = 256;

// PNG Signature
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const chunk = Buffer.concat([typeBuf, data]);
    
    // Calculate CRC32
    let crc = -1;
    for (let i = 0; i < chunk.length; i++) {
        crc ^= chunk[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    crc ^= -1;
    
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc, 0);
    
    return Buffer.concat([length, chunk, crcBuf]);
}

// IHDR Chunk
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(width, 0);
ihdrData.writeUInt32BE(height, 4);
ihdrData[8] = 8; // bit depth
ihdrData[9] = 6; // color type: truecolor with alpha
ihdrData[10] = 0; // compression
ihdrData[11] = 0; // filter
ihdrData[12] = 0; // interlace
const ihdr = createChunk('IHDR', ihdrData);

// IDAT Chunk
const rawData = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
        const offset = y * (width * 4 + 1) + 1 + x * 4;
        rawData[offset] = 255;     // R
        rawData[offset + 1] = 0;   // G
        rawData[offset + 2] = 0;   // B
        rawData[offset + 3] = 255; // A
    }
}
const compressed = zlib.deflateSync(rawData);
const idat = createChunk('IDAT', compressed);

// IEND Chunk
const iend = createChunk('IEND', Buffer.alloc(0));

const png = Buffer.concat([signature, ihdr, idat, iend]);
fs.writeFileSync('assets/icon.png', png);

console.log('Created valid 256x256 PNG at assets/icon.png');
