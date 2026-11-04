// Generate compiler-verified offsets from this client's packed C++ structures.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'ElementClient/CCommon/ExpTypes.h'), 'utf8');
const clean = source.replaceAll('NUM_WEAPON_TYPE', '15').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const manager = fs.readFileSync(path.join(root, 'ElementClient/CCommon/elementdataman.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'ElementClient/CCommon/elementdataman.h'), 'utf8');
const types = new Map([...header.matchAll(/array<([A-Z_0-9]+)>\s*(\w+);/g)].map(m => [m[2],m[1]]));
const load = manager.slice(manager.indexOf('int elementdataman::load_data'));
const order = [...load.matchAll(/if\((\w+)\.load\(/g)].map(m => types.get(m[1]));
if (order.some(x=>!x)) throw Error('Unresolved list');
function body(type) {
 const m = new RegExp('struct\\s+'+type+'\\s*(?::\\s*public\\s+(\\w+)\\s*)?\\{').exec(clean);
 if(!m) throw Error(type);
 let i=m.index+m[0].length, start=i, depth=1;
 for(;depth;i++){if(clean[i]==='{')depth++;if(clean[i]==='}')depth--;}
 return (m[1]?body(m[1]):'')+clean.slice(start,i-1);
}
function fields(b,prefix='') {
 let result=[], start=0, depth=0;
 for(let i=0;i<b.length;i++){
  if(b[i]==='{')depth++; if(b[i]==='}')depth--;
  if(b[i]!==';'||depth)continue;
  const decl=b.slice(start,i).trim();start=i+1;
  if(!decl)continue;
  if(decl.startsWith('union')) {
   const match=/UINT64\s+(\w+)/.exec(decl);if(!match)throw Error(decl);
   result.push({name:prefix+match[1],kind:'u64',array:''});
  } else if(decl.startsWith('struct')) {
   const end=decl.lastIndexOf('}'), member=decl.slice(end+1).trim();
   const m=/^(\w+)(?:\[([^\]]+)\])?$/.exec(member);
   if(!m)throw Error(decl);
   let count=m[2]||'1';
   count=count.replace(/ELEMENTDATA_\w+/g, token=> {const v=new RegExp(token+'\\s*=\\s*(\\d+)').exec(source);if(!v)throw Error(token);return v[1];});
   if(!/^[\d\s*+]+$/.test(count))throw Error(count);
   for(let n=0;n<Function('return '+count)();n++)result.push(...fields(decl.slice(decl.indexOf('{')+1,end),prefix+m[1]+(m[2]?`[${n}]`:'')+'.'));
  } else {
   const m=/^(unsigned\s+int|unsigned\s+long|unsigned|int|float|double|char|namechar|unsigned\s+short|short|UINT64|INT64)\s+(\w+)((?:\[[^\]]+\])*)$/.exec(decl);
   if(!m)throw Error('Unknown declaration: '+decl);
   const kind=({int:'i32',float:'f32',double:'f64',char:'gbk',namechar:'utf16',UINT64:'u64',INT64:'i64',short:'i16','unsigned short':'u16','unsigned int':'u32',unsigned:'u32','unsigned long':'u32'})[m[1].replace(/\s+/g,' ')];
   result.push({name:prefix+m[2],kind,array:m[3]});
  }
 }
 return result;
}
let cpp='#include <cstdio>\n#include <cstddef>\n#include "'+path.join(root,'ElementClient/CCommon/ExpTypes.h').replaceAll('\\','/')+'"\nint main(){ puts("[");\n';
order.forEach((type,index)=>{
 cpp+=`printf("${index?',':''}{\\"name\\":\\"${type}\\",\\"size\\":%u,\\"fields\\":[",(unsigned)sizeof(${type}));\n`;
 fields(body(type)).forEach((f,i)=>{
  const expr=`((${type}*)0)->${f.name}`;
  const unit= f.kind==='gbk'?1:f.kind==='utf16'||f.kind==='i16'||f.kind==='u16'?2:f.kind.endsWith('64')?8:4;
  cpp+=`printf("${i?',':''}{\\"name\\":\\"${f.name}\\",\\"kind\\":\\"${f.kind}\\",\\"offset\\":%u,\\"size\\":%u,\\"unit\\":${unit}}",(unsigned)offsetof(${type},${f.name}),(unsigned)sizeof(${expr}));\n`;
 });
 cpp+='puts("]}");\n';
});
cpp+='puts("]");}\n';
fs.writeFileSync(path.resolve(import.meta.dirname,'../native-gfx/elements-schema.cpp'),cpp);
console.log(`Generated ${order.length} list layouts`);
