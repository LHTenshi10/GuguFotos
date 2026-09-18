const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
const DB = path.join(DATA, 'database.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'gugu123';

for (const dir of [DATA, UPLOADS]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({albums:[],photos:[],nextAlbumId:1,nextPhotoId:1}, null, 2));
function readDB(){ return JSON.parse(fs.readFileSync(DB,'utf8')); }
function writeDB(db){ fs.writeFileSync(DB, JSON.stringify(db,null,2)); }
function slugify(s){ return s.toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function safeName(name){ return name.replace(/[^a-zA-Z0-9._-]/g,'_'); }
function requireAdmin(req,res,next){ if(req.session.admin) return next(); return res.status(401).json({error:'Não autorizado'}); }

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET || 'gugufotos-local-secret-change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(path.join(ROOT,'public')));

const upload = multer({storage:multer.diskStorage({
  destination:(req,file,cb)=>cb(null,UPLOADS),
  filename:(req,file,cb)=>cb(null, Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safeName(file.originalname))
}), limits:{fileSize:15*1024*1024,files:100}, fileFilter:(req,file,cb)=>{
  if(/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null,true); else cb(new Error('Apenas imagens JPG, PNG, WEBP ou GIF.'));
}});

app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/api/albums',(req,res)=>{
  const db=readDB(); const q=(req.query.q||'').toLowerCase();
  let albums=db.albums.filter(a=>!q || (a.title+' '+(a.description||'')).toLowerCase().includes(q));
  res.json(albums.map(a=>({...a,photoCount:db.photos.filter(p=>p.albumId===a.id).length})));
});
app.get('/api/albums/:id',(req,res)=>{
  const db=readDB(), a=db.albums.find(x=>x.id===Number(req.params.id));
  if(!a) return res.status(404).json({error:'Álbum não encontrado'});
  res.json({...a,photos:db.photos.filter(p=>p.albumId===a.id)});
});

app.post('/api/admin/login',(req,res)=>{
  if(req.body.password !== ADMIN_PASSWORD) return res.status(401).json({error:'Senha incorreta'});
  req.session.admin=true; res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',(req,res)=>res.json({authenticated:!!req.session.admin}));
app.post('/api/admin/albums',requireAdmin,upload.single('cover'),(req,res)=>{
  const db=readDB(); const title=(req.body.title||'').trim();
  if(!title) return res.status(400).json({error:'Título obrigatório'});
  const album={id:db.nextAlbumId++,title,slug:slugify(title),description:(req.body.description||'').trim(),cover:null,createdAt:new Date().toISOString()};
  db.albums.unshift(album);
  if(req.file){ const photo={id:db.nextPhotoId++,albumId:album.id,filename:req.file.filename,originalName:req.file.originalname,url:'/uploads/'+req.file.filename,createdAt:new Date().toISOString()}; db.photos.push(photo); album.cover=photo.url; }
  writeDB(db); res.json(album);
});
app.put('/api/admin/albums/:id',requireAdmin,upload.single('cover'),(req,res)=>{
  const db=readDB(), a=db.albums.find(x=>x.id===Number(req.params.id)); if(!a)return res.status(404).json({error:'Álbum não encontrado'});
  if(req.body.title!==undefined){a.title=req.body.title.trim();a.slug=slugify(a.title)} if(req.body.description!==undefined)a.description=req.body.description.trim();
  if(req.file){ if(a.cover){const old=db.photos.find(p=>p.url===a.cover);if(old){try{fs.unlinkSync(path.join(UPLOADS,old.filename))}catch{}}db.photos=db.photos.filter(p=>p!==old)} const p={id:db.nextPhotoId++,albumId:a.id,filename:req.file.filename,originalName:req.file.originalname,url:'/uploads/'+req.file.filename,createdAt:new Date().toISOString()};db.photos.push(p);a.cover=p.url; }
  writeDB(db);res.json(a);
});
app.delete('/api/admin/albums/:id',requireAdmin,(req,res)=>{
  const db=readDB(), id=Number(req.params.id), a=db.albums.find(x=>x.id===id); if(!a)return res.status(404).json({error:'Álbum não encontrado'});
  db.photos.filter(p=>p.albumId===id).forEach(p=>{try{fs.unlinkSync(path.join(UPLOADS,p.filename))}catch{}}); db.photos=db.photos.filter(p=>p.albumId!==id); db.albums=db.albums.filter(x=>x.id!==id); writeDB(db);res.json({ok:true});
});
app.post('/api/admin/albums/:id/photos',requireAdmin,upload.array('photos',100),(req,res)=>{
  const db=readDB(), id=Number(req.params.id), a=db.albums.find(x=>x.id===id);if(!a)return res.status(404).json({error:'Álbum não encontrado'});
  const photos=req.files.map(f=>({id:db.nextPhotoId++,albumId:id,filename:f.filename,originalName:f.originalname,url:'/uploads/'+f.filename,createdAt:new Date().toISOString()})); db.photos.push(...photos); if(!a.cover&&photos[0])a.cover=photos[0].url; writeDB(db);res.json(photos);
});
app.delete('/api/admin/photos/:id',requireAdmin,(req,res)=>{
  const db=readDB(), id=Number(req.params.id), p=db.photos.find(x=>x.id===id);if(!p)return res.status(404).json({error:'Foto não encontrada'});
  try{fs.unlinkSync(path.join(UPLOADS,p.filename))}catch{} db.photos=db.photos.filter(x=>x.id!==id); const a=db.albums.find(x=>x.id===p.albumId);if(a&&a.cover===p.url){const next=db.photos.find(x=>x.albumId===a.id);a.cover=next?next.url:null} writeDB(db);res.json({ok:true});
});
app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'public/admin/index.html')));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(ROOT,'public/admin/login.html')));
app.get('/admin/album',(req,res)=>res.sendFile(path.join(ROOT,'public/admin/album.html')));
app.use((err,req,res,next)=>res.status(400).json({error:err.message||'Erro'}));
app.listen(PORT,'0.0.0.0',()=>console.log(`\nGuguFotos rodando em http://localhost:${PORT}\nSenha local do admin: ${ADMIN_PASSWORD}\n`));
