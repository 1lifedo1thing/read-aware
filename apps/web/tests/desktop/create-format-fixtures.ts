import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { makeEPUBFixture } from "../fixtures/foliate-epub";
import { makeMOBI6Fixture, makeKF8Fixture } from "../fixtures/foliate-mobi";
import { fb2Fixture } from "../fixtures/foliate-books";

const directory = resolve(process.argv[2] ?? ".eval/validation-20260913-formats");
await mkdir(directory, { recursive: true });
const epub: Record<string, string> = {};
for (const [name, content] of makeEPUBFixture().files) epub[name] = typeof content === "string" ? content : await content.text();
const input = JSON.stringify({directory,epub,fb2:fb2Fixture});
const python = String.raw`
import json, sys, zipfile, pathlib, struct, zlib
x=json.load(sys.stdin); root=pathlib.Path(x['directory'])
with zipfile.ZipFile(root/'fixture.epub','w') as z:
 z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
 for name,content in x['epub'].items(): z.writestr(name,content,compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(root/'fixture.fb2.zip','w') as z: z.writestr('fixture.fb2',x['fb2'],compress_type=zipfile.ZIP_DEFLATED)
def png(rgb):
 def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
 rows=b''.join(b'\0'+bytes(rgb)*64 for _ in range(96))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,96,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
with zipfile.ZipFile(root/'fixture.cbz','w') as z:
 z.writestr('page2.png',png((30,100,220))); z.writestr('page10.png',png((240,150,30)))
`;
const proc = Bun.spawn(["python3","-c",python], {stdin:new Blob([input]),stdout:"inherit",stderr:"inherit"});
if (await proc.exited !== 0) throw Error("Archive fixture creation failed");
await Bun.write(resolve(directory,"fixture.mobi"),makeMOBI6Fixture({compression:2}).file);
await Bun.write(resolve(directory,"fixture.azw3"),makeKF8Fixture().file);
await Bun.write(resolve(directory,"encrypted.mobi"),makeMOBI6Fixture({encrypted:true}).file);
await Bun.write(resolve(directory,"fixture.txt"),"Plain text fixture 中文.\n\n" + "This paragraph verifies native text import and extraction. ".repeat(4));
await Bun.write(resolve(directory,"fixture.html"),'<html><head><meta charset="utf-8"><title>HTML Format Fixture</title></head><body><h1>HTML chapter</h1><p>HTML fixture 中文. This paragraph verifies native HTML import and extraction.</p></body></html>');
console.log(JSON.stringify({directory,files:["fixture.epub","fixture.mobi","fixture.azw3","fixture.fb2.zip","fixture.cbz","fixture.txt","fixture.html","encrypted.mobi"]}));
