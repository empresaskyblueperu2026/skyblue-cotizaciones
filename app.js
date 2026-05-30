/* SKY BLUE PWA - Logic */
(function(){
'use strict';
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}
var _dp=null;
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();_dp=e;var b=document.getElementById('_ibanner');if(b)setTimeout(function(){b.style.display='flex';},4000);});
var _ib=document.getElementById('_installBtn');
if(_ib)_ib.addEventListener('click',function(){var b=document.getElementById('_ibanner');if(b)b.style.display='none';if(_dp){_dp.prompt();_dp=null;}else alert('En Safari: toca Compartir luego Agregar a inicio');});
var _db2=document.getElementById('_dismissBtn');
if(_db2)_db2.addEventListener('click',function(){var b=document.getElementById('_ibanner');if(b)b.style.display='none';});
function updateOnlineBanner(){var ob=document.getElementById('_offbar');if(ob)ob.style.display=navigator.onLine?'none':'block';}
window.addEventListener('online',function(){updateOnlineBanner();showNetBanner(true);});
window.addEventListener('offline',function(){updateOnlineBanner();showNetBanner(false);});
updateOnlineBanner();
function getAPIUrl(){return(window.location.protocol==='file:')?'https://api.anthropic.com/v1/messages':'/api/claude';}
var LOGO=window.SKY_ASSETS.logo;
var LPROV=window.SKY_ASSETS.prov;
var LISO=window.SKY_ASSETS.iso;
/* ─── ASSETS (from hidden img tags, avoids Safari JS string crash) ─── */

/* ─── EMPRESA ─── */
var EMP = {
  nombre:'SKY BLUE PERU S.A.C.', ruc:'20610723501',
  dir:'CAL.JUAN JULIO GANOZA NRO. 465 DPTO. 701 URB. CALIFORNIA',
  cel:'926 533 360', email:'Skyblueperuglobal@gmail.com',
  banco:'INTERBANK', cci:'003-200-003006228729-34',
  gerente:'SKY BLUE PERU S.A.C.'
};

/* ─── CATALOGO BASE ─── */


/* ─── CONSTANTES ─── */
var USUARIOS = ['Diego Polo - Gerente','Vendedor 1','Vendedor 2','Vendedor 3'];
var PAGOS    = ['Contado','50% adelanto / 50% entrega','Credito 15 dias','Credito 30 dias','Credito 45 dias','Por acordar'];
var ENTREGAS = ['Inmediato','2-3 dias habiles','5-7 dias habiles','10-15 dias habiles','A coordinar'];
var VALIDS   = ['7 dias calendario','15 dias calendario','30 dias calendario','Hasta agotar stock'];
var SK = 'sbv8';

/* ─── STATE ─── */
var S = {
  tab:'cot', user:USUARIOS[0], mon:'S/', pago:PAGOS[0],
  entr:ENTREGAS[0], valid:VALIDS[1], igv:true,
  num:'001', ver:'00', proy:'',
  cli:{n:'',ruc:'',con:'',tel:'',mail:'',dir:''},
  items:[], hist:[], extra:[], compras:[],
  modal:null   /* 'add'|'ext'|'compra' */
};

/* ─── PERSIST ─── */
function loadS(){
  try{
    var d=JSON.parse(localStorage.getItem(SK)||'null');
    if(!d)return;
    ['user','mon','pago','entr','valid','igv','num','ver','hist','extra','compras'].forEach(function(k){
      if(k in d)S[k]=d[k];
    });
  }catch(e){}
  if(!S.items.length)S.items=[newItem()];
}
function saveS(){
  try{
    localStorage.setItem(SK,JSON.stringify({
      user:S.user,mon:S.mon,pago:S.pago,entr:S.entr,valid:S.valid,igv:S.igv,
      num:S.num,ver:S.ver,hist:S.hist,extra:S.extra,compras:S.compras
    }));
  }catch(e){}
}

/* ─── HELPERS ─── */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function newItem(){ return {id:uid(),cod:'',desc:'',qty:1,precio:0}; }
function catalog(){ return CATBASE.concat(S.extra); }
function allCats(){
  var c=['Todos'],seen={};
  catalog().forEach(function(p){ if(!seen[p.c]){seen[p.c]=1;c.push(p.c);} });
  return c.sort(function(a,b){ return a==='Todos'?-1:b==='Todos'?1:a.localeCompare(b); });
}
function fmt(n,cur){
  return (cur||S.mon)+' '+(+n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function today(){
  return new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function numLetras(n){
  if(!n)return'CERO Y 00/100';
  var U=['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE',
    'TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE',
    'VEINTIUNO','VEINTIDOS','VEINTITRES','VEINTICUATRO','VEINTICINCO','VEINTISEIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE'];
  var D=['','','VEINTI','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  var C=['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  var e=Math.floor(n),dc=Math.round((n-e)*100);
  function w(x){
    if(!x)return''; if(x===100)return'CIEN';
    var r='',c=Math.floor(x/100),rs=x%100;
    if(c)r+=C[c]+' ';
    if(rs<30)r+=U[rs];
    else{r+=D[Math.floor(rs/10)];if(rs%10)r+=' Y '+U[rs%10];}
    return r.trim();
  }
  var m=Math.floor(e/1000),r=e%1000;
  return((m===1?'MIL ':m>1?w(m)+' MIL ':'')+w(r)).trim()+' Y '+String(dc).padStart(2,'0')+'/100';
}
function totals(){
  var sub=S.items.reduce(function(a,it){return a+(it.qty||1)*(it.precio||0);},0);
  var igv=S.igv?sub*.18:0;
  return{sub:sub,igv:igv,tot:sub+igv};
}

/* ─── SEARCH INDEX ─── */
var IDX=[];
function buildIdx(){
  IDX=catalog().map(function(p){ return{p:p,k:(p.id+' '+p.n+' '+p.p+' '+p.c).toLowerCase()}; });
}
function search(q,lim){
  var ql=(q||'').toLowerCase().trim();
  var out=[];
  for(var i=0;i<IDX.length;i++){
    if(!ql||IDX[i].k.includes(ql)){
      out.push(IDX[i].p);
      if(out.length>=(lim||15))break;
    }
  }
  return out;
}

/* ─── RENDER ENGINE ─── */
var _raf=null;
function setState(patch){
  Object.assign(S,patch);
  saveS();
  if(_raf)return;
  _raf=requestAnimationFrame(function(){ _raf=null; renderApp(); });
}

/* ─── NAV ─── */
var TABS=[
  {id:'cot',   ic:'📝', lb:'Cotizar'},
  {id:'preview',ic:'👁', lb:'Previa'},
  {id:'hist',  ic:'📋', lb:'Historial'},
  {id:'cat',   ic:'📦', lb:'Catalogo'},
  {id:'compras',ic:'📥',lb:'Compras'}
];

/* ─── MAIN RENDER ─── */
function renderApp(){
  document.getElementById('_tlogo').src=LOGO;

  /* top nav */
  var tn=document.getElementById('_tnav'); tn.innerHTML='';
  TABS.forEach(function(t){
    var on=S.tab===t.id;
    var b=document.createElement('button');
    b.textContent=t.ic+' '+t.lb;
    b.style.cssText='padding:6px 10px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:600;' +
      'background:'+(on?'rgba(42,183,169,.85)':'transparent')+';color:'+(on?'white':'rgba(255,255,255,.55)')+';';
    b.onclick=function(){ setState({tab:t.id}); };
    tn.appendChild(b);
  });

  /* user select */
  var us=document.getElementById('_usel');
  if(!us.children.length){
    USUARIOS.forEach(function(u){ var o=document.createElement('option');o.value=u;o.textContent=u;us.appendChild(o); });
    us.onchange=function(){ setState({user:us.value}); };
  }
  us.value=S.user;

  /* bottom nav */
  var bn=document.getElementById('_bnav'); bn.innerHTML='';
  TABS.forEach(function(t){
    var on=S.tab===t.id;
    var b=document.createElement('button');
    b.className='ntab'+(on?' on':'');
    b.innerHTML='<span style="font-size:20px;line-height:1">'+t.ic+'</span>' +
      '<span style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase">'+t.lb+'</span>' +
      (on?'<div style="width:14px;height:2px;border-radius:1px;background:#2ab7a9;margin-top:2px"></div>':'');
    b.onclick=function(){ setState({tab:t.id}); };
    bn.appendChild(b);
  });

  /* main content */
  var cont=document.getElementById('_cont'); cont.innerHTML='';
  if(S.tab==='cot')    cont.appendChild(renderCot());
  if(S.tab==='preview')cont.appendChild(renderPreview());
  if(S.tab==='hist')   cont.appendChild(renderHist());
  if(S.tab==='cat')    cont.appendChild(renderCat());
  if(S.tab==='compras')cont.appendChild(renderCompras());

  /* modal */
  document.body.style.overflow=S.modal?'hidden':'';
  var mr=document.getElementById('_modal'); mr.innerHTML='';
  if(S.modal==='add')    mr.appendChild(modalAdd());
  if(S.modal==='import') mr.appendChild(modalImport());
}

/* ─── COT TAB ─── */
function renderCot(){
  var t=totals();
  var wrap=el('div','maxWidth:1100px;margin:0 auto;padding:14px 12px;display:flex;flexWrap:wrap;gap:14px');

  /* LEFT panel */
  var L=el('div','width:100%;maxWidth:300px;minWidth:250px;display:flex;flexDirection:column');

  /* ID */
  var idC=card();
  idC.appendChild(stitle('Identificacion'));
  var g1=el('div','display:grid;gridTemplateColumns:1fr 1fr;gap:12px;marginBottom:12px');
  g1.appendChild(fieldEl('N Cotizacion',S.num,function(v){S.num=v;saveS();}));
  g1.appendChild(fieldEl('Version',S.ver,function(v){S.ver=v;saveS();}));
  idC.appendChild(g1);
  idC.appendChild(selEl('Elaborado por',S.user,USUARIOS,function(v){setState({user:v});}));
  idC.appendChild(el('div','marginTop:12px',[fieldEl('Proyecto',S.proy,function(v){S.proy=v;saveS();},{ ph:'Codigo o nombre'})]));
  L.appendChild(idC);

  /* CLIENTE */
  var cliC=card();
  cliC.appendChild(stitle('Cliente'));
  function cf(lbl,k,ph){
    return fieldEl(lbl,S.cli[k],function(v){
      S.cli=Object.assign({},S.cli); S.cli[k]=v; saveS();
    },{ph:ph});
  }
  cliC.appendChild(cf('Razon Social','n','Empresa S.A.C.'));
  var g2=el('div','display:grid;gridTemplateColumns:1fr 1fr;gap:10px');
  g2.appendChild(cf('RUC','ruc','20xxxxxxxxx'));
  g2.appendChild(cf('Telefono','tel','+51'));
  cliC.appendChild(g2);
  cliC.appendChild(cf('Contacto','con','Nombre'));
  cliC.appendChild(cf('Correo','mail','correo@empresa.com'));
  cliC.appendChild(cf('Direccion','dir','Calle, distrito'));
  L.appendChild(cliC);

  /* CONDICIONES */
  var coC=card();
  coC.appendChild(stitle('Condiciones'));
  var g3=el('div','display:grid;gridTemplateColumns:1fr 1fr;gap:10px;marginBottom:12px');
  g3.appendChild(selEl('Moneda',S.mon,[{v:'S/',l:'S/ Soles'},{v:'US$',l:'US$ Dolares'}],function(v){setState({mon:v});}));
  g3.appendChild(selEl('IGV',S.igv?'si':'no',[{v:'si',l:'Con IGV 18%'},{v:'no',l:'Sin IGV'}],function(v){setState({igv:v==='si'});}));
  coC.appendChild(g3);
  coC.appendChild(selEl('Forma de pago',S.pago,PAGOS,function(v){setState({pago:v});}));
  coC.appendChild(el('div','marginTop:12px',[selEl('Tiempo de entrega',S.entr,ENTREGAS,function(v){setState({entr:v});})]));
  coC.appendChild(el('div','marginTop:12px',[selEl('Validez',S.valid,VALIDS,function(v){setState({valid:v});})]));
  L.appendChild(coC);

  /* RESUMEN */
  var reC=card();
  reC.appendChild(stitle('Resumen'));
  reC.appendChild(el('div','display:flex;flexDirection:column;gap:4px;marginBottom:12px',[
    totRow('Subtotal',fmt(t.sub)),
    S.igv?totRow('IGV 18%',fmt(t.igv)):null,
    totFin(fmt(t.tot)),
    el('div','fontSize:9px;color:#94a3b8;fontStyle:italic;textAlign:right;marginTop:3px;lineHeight:1.5',
      [numLetras(t.tot)+' '+(S.mon==='S/'?'SOLES':'DOLARES')])
  ].filter(Boolean)));
  reC.appendChild(btn('👁  Ver previa / Imprimir','bp',true,function(){setState({tab:'preview'});}));
  reC.appendChild(btn('💾  Guardar cotizacion','bg',true,guardar));
  reC.appendChild(btn('📎  Cargar cotizacion del proveedor','bb',true,function(){setState({modal:'import'});}));
  L.appendChild(reC);
  wrap.appendChild(L);

  /* RIGHT — items */
  var R=el('div','flex:1;minWidth:280px');
  var ih=el('div','display:flex;alignItems:center;justifyContent:space-between;marginBottom:12px',[
    el('div','fontSize:10px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8',['Productos ('+S.items.length+')']),
    btnSmall('+ Agregar','#0f766e',function(){setState({items:S.items.concat([newItem()])});})
  ]);
  R.appendChild(ih);
  S.items.forEach(function(item,idx){ R.appendChild(renderItem(item,idx)); });
  wrap.appendChild(R);
  return wrap;
}

function makePDFHtml(cotData){
  /* Build a standalone printable HTML page from a cotizacion snapshot */
  /* cotData can be null (use current state) or a saved hist entry */
  var savedState=null;
  if(cotData){
    /* temporarily swap state to render saved cotizacion */
    savedState={items:S.items,cli:S.cli,num:S.num,ver:S.ver,proy:S.proy,mon:S.mon,pago:S.pago,entr:S.entr,valid:S.valid,igv:S.igv,user:S.user};
    S.items=cotData.items||[];
    S.cli=cotData.cli||{n:'',ruc:'',con:'',tel:'',mail:'',dir:''};
    S.num=cotData.num||'001';
    S.ver=cotData.ver||'00';
    S.proy=cotData.proy||'';
    S.mon=cotData.mon||'S/';
    S.pago=cotData.pago||'Contado';
    S.entr=cotData.entr||'Inmediato';
    S.valid=cotData.valid||'15 dias calendario';
    S.igv=true;
    S.user=cotData.user||'';
  }

  var docNode=buildPDF();
  var tmp=document.createElement('div');
  tmp.appendChild(docNode);
  var docHTML=tmp.innerHTML;

  if(savedState){ Object.assign(S,savedState); }

  var css='*{box-sizing:border-box;margin:0;padding:0}'+
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;background:white}'+
    '@media print{@page{margin:8mm;size:A4 portrait}body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}'+
    '@media screen{body{padding:12px;background:#eef2f7}#_wrap{max-width:820px;margin:0 auto;background:white;box-shadow:0 4px 20px rgba(0,0,0,.12);border-radius:8px;overflow:hidden}'+
    '#_pbar{background:#0d3b6e;padding:10px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'+
    '.pbtn{display:inline-flex;align-items:center;font-weight:600;padding:9px 18px;border-radius:10px;cursor:pointer;font-size:13px;border:none}'+
    '.pbtn:active{opacity:.7}}';

  var printBtn='<div id="_pbar"><button class="pbtn" style="background:#2ab7a9;color:white" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>'+
    '<span style="color:rgba(255,255,255,.7);font-size:11px;margin-left:8px">iOS: toca Imprimir → Guardar como PDF</span>'+
    '<button class="pbtn" style="background:rgba(255,255,255,.15);color:white;margin-left:auto" onclick="window.close()">✕ Cerrar</button></div>';

  var cotNum=S.num;
  if(cotData)cotNum=cotData.num;

  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>COT-'+cotNum+' SKY BLUE PERU S.A.C.</title>'+
    '<style>'+css+'</style></head><body>'+
    printBtn+
    '<div id="_wrap">'+docHTML+'</div>'+
    '</body></html>';
}

function openPDF(html, filename){
  /* Try multiple strategies for cross-device compatibility */
  filename = filename || 'cotizacion.html';

  /* Strategy 1: <a download> — works on Android Chrome, Desktop */
  try{
    var blob=new Blob([html],{type:'text/html;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url; a.download=filename; a.target='_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},15000);
    return;
  }catch(e1){}

  /* Strategy 2: window.open with document.write — iOS Safari, Desktop */
  try{
    var w2=window.open('','_blank');
    if(w2&&w2.document){
      w2.document.open();
      w2.document.write(html);
      w2.document.close();
      return;
    }
  }catch(e2){}

  /* Strategy 3: data URI — last resort */
  try{
    var enc=encodeURIComponent(html);
    window.location.href='data:text/html;charset=utf-8,'+enc;
  }catch(e3){ window.print(); }
}

function exportPDF(){
  var html=makePDFHtml(null);
  openPDF(html,'COT-'+S.num+'-SKY-BLUE.html');
}

function exportHistPDF(cotData){
  var html=makePDFHtml(cotData);
  openPDF(html,'COT-'+cotData.num+'-'+((cotData.cli&&cotData.cli.n)||'cliente').replace(/\s+/g,'-').slice(0,20)+'.html');
}

function guardar(){
  var t=totals();
  var co={num:S.num,ver:S.ver,fecha:today(),cli:Object.assign({},S.cli),proy:S.proy,
    mon:S.mon,pago:S.pago,entr:S.entr,valid:S.valid,igv:S.igv,items:S.items.slice(),tot:t.tot,user:S.user};
  var n=parseInt(S.num,10);
  setState({hist:[co].concat(S.hist), num:isNaN(n)?S.num:String(n+1).padStart(3,'0')});
  alert('✅ Cotizacion COT-'+co.num+' guardada en Historial');
}

/* Item card with INLINE autocomplete — no re-render on every keystroke */
function renderItem(item,idx){
  var card2=el('div','background:white;borderRadius:14px;border:1px solid #e2e8f0;boxShadow:0 1px 3px rgba(0,0,0,.05);overflow:hidden;marginBottom:10px');

  /* header */
  var hdr=el('div','display:flex;alignItems:center;padding:9px 14px 8px;borderBottom:1px solid #f8fafc;gap:8px');
  var inum=el('span','width:22px;height:22px;borderRadius:50%;background:#2ab7a9;color:white;fontSize:10px;fontWeight:700;display:flex;alignItems:center;justifyContent:center;flexShrink:0',[String(idx+1)]);
  hdr.appendChild(inum);
  if(item._prod){
    hdr.appendChild(chipEl(item._prod.p, item._prod.p==='MERINSA'?'cg':item._prod.p==='JAMPAR'?'cb':'ct'));
    hdr.appendChild(chipEl(item._prod.id,'cs'));
  }
  var del=el('button','marginLeft:auto;width:28px;height:28px;borderRadius:8px;border:none;background:#fef2f2;color:#f87171;cursor:pointer;fontSize:16px;display:flex;alignItems:center;justifyContent:center',['×']);
  del.onclick=function(){
    if(S.items.length>1) setState({items:S.items.filter(function(i){return i.id!==item.id;})});
  };
  hdr.appendChild(del);
  card2.appendChild(hdr);

  /* autocomplete — built with native DOM, no re-render */
  var body=el('div','padding:10px 14px 4px');
  var acWrap=el('div','position:relative');
  var acInp=document.createElement('input');
  acInp.type='text';
  acInp.placeholder='Buscar por nombre, codigo o proveedor...';
  acInp.value=item.desc||'';
  acInp.style.cssText='width:100%;border:1px solid #e2e8f0;borderRadius:10px;padding:9px 12px;fontSize:13px;outline:none;background:white;boxSizing:border-box';
  acInp.onfocus=function(){acInp.style.borderColor='#2ab7a9';acInp.style.boxShadow='0 0 0 3px rgba(42,183,169,.1)'; if(acDrop.innerHTML==='')showDrop(acInp.value);};
  acInp.onblur=function(){acInp.style.borderColor='#e2e8f0';acInp.style.boxShadow=''; setTimeout(function(){acDrop.style.display='none';},200);};

  var acDrop=el('div','position:absolute;top:calc(100% + 4px);left:0;right:0;zIndex:200;background:white;border:1px solid #e2e8f0;borderRadius:10px;boxShadow:0 8px 24px rgba(0,0,0,.12);maxHeight:240px;overflowY:auto;display:none');
  var selIdx=-1;
  var deb=null;

  function showDrop(q){
    var res=search(q,15);
    acDrop.innerHTML='';
    selIdx=-1;
    if(!res.length){acDrop.style.display='none';return;}
    res.forEach(function(p){
      var row=el('div','padding:9px 12px;cursor:pointer;borderBottom:1px solid #f8fafc;display:flex;gap:8px;alignItems:flex-start');
      var L2=el('div','flex:1;minWidth:0');
      L2.appendChild(el('div','fontSize:12px;fontWeight:500;color:#1e293b;lineHeight:1.35',[p.n]));
      var meta=el('div','display:flex;gap:4px;flexWrap:wrap;marginTop:3px',[chipEl(p.id,'cs'),chipEl(p.p,p.p==='MERINSA'?'cg':p.p==='JAMPAR'?'cb':'ct')]);
      L2.appendChild(meta);
      row.appendChild(L2);
      if(p.v>0) row.appendChild(el('div','fontSize:12px;fontWeight:700;color:#2ab7a9;flexShrink:0',[fmt(p.v)]));
      row.onmousedown=function(e){
        e.preventDefault();
        acInp.value=p.n;
        acDrop.style.display='none';
        /* update item in place WITHOUT full re-render */
        S.items=S.items.map(function(it){
          if(it.id!==item.id)return it;
          var c=Object.assign({},it,{desc:p.n,cod:p.id,_prod:p});
          if(p.v>0)c.precio=p.v;
          return c;
        });
        saveS();
        /* just update header chips without full render */
        inum.textContent=String(idx+1);
        hdr.querySelectorAll('.chip').forEach(function(x){x.remove();});
        hdr.insertBefore(chipEl(p.p,p.p==='MERINSA'?'cg':p.p==='JAMPAR'?'cb':'ct'), del);
        hdr.insertBefore(chipEl(p.id,'cs'), del);
        /* update totals display */
        updateTotalsDisplay();
      };
      acDrop.appendChild(row);
    });
    acDrop.style.display='block';
  }

  acInp.oninput=function(){
    item.desc=acInp.value;
    item._prod=null;
    item.cod='';
    saveS();
    clearTimeout(deb);
    deb=setTimeout(function(){ showDrop(acInp.value); },80);
  };
  acInp.onkeydown=function(e){
    var rows=acDrop.querySelectorAll('div[onmousedown]');
    if(!rows.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();selIdx=Math.min(selIdx+1,rows.length-1);rows.forEach(function(r,i){r.style.background=i===selIdx?'#f0fdfa':'';});}
    else if(e.key==='ArrowUp'){e.preventDefault();selIdx=Math.max(selIdx-1,-1);rows.forEach(function(r,i){r.style.background=i===selIdx?'#f0fdfa':'';});}
    else if(e.key==='Enter'&&selIdx>=0){rows[selIdx].dispatchEvent(new MouseEvent('mousedown'));}
    else if(e.key==='Escape'){acDrop.style.display='none';}
  };
  acWrap.appendChild(acInp);
  acWrap.appendChild(acDrop);
  body.appendChild(acWrap);
  card2.appendChild(body);

  /* qty / price / total */
  var foot=el('div','padding:8px 14px 14px;display:grid;gridTemplateColumns:1fr 1fr 1fr;gap:8px');

  function numFld(lbl,val,updateKey,isQty){
    var w=el('div','');
    w.appendChild(el('div','fontSize:9px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;marginBottom:4px',[lbl]));
    var i=document.createElement('input');
    i.type='number'; i.value=String(val);
    i.min=isQty?'1':'0'; i.step=isQty?'1':'0.01';
    i.style.cssText='width:100%;fontSize:14px;fontWeight:600;textAlign:'+(isQty?'center':'right')+';border:1px solid #e2e8f0;borderRadius:10px;padding:8px;outline:none;boxSizing:border-box';
    i.onfocus=function(){i.style.borderColor='#2ab7a9';};
    i.onblur=function(){i.style.borderColor='#e2e8f0';};
    i.onchange=function(){
      var v=parseFloat(i.value)||0;
      if(isQty)v=Math.max(1,v);
      S.items=S.items.map(function(it){
        if(it.id!==item.id)return it;
        var c=Object.assign({},it); c[updateKey]=v; return c;
      });
      saveS();
      updateTotalCell();
      updateTotalsDisplay();
    };
    w.appendChild(i);
    return w;
  }

  var qFld=numFld('Cant.',item.qty||1,'qty',true);
  var pFld=numFld('P. Venta',item.precio||0,'precio',false);

  var totW=el('div','');
  totW.appendChild(el('div','fontSize:9px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;marginBottom:4px',['Total']));
  var totCell=el('div','fontSize:14px;fontWeight:700;color:#0f766e;textAlign:right;border:1px solid #ccfbf1;borderRadius:10px;padding:8px;background:#f0fdfa',
    [fmt((item.qty||1)*(item.precio||0))]);

  function updateTotalCell(){
    var it=S.items.find(function(x){return x.id===item.id;});
    if(it) totCell.textContent=fmt((it.qty||1)*(it.precio||0));
  }

  foot.appendChild(qFld); foot.appendChild(pFld); foot.appendChild(totW);
  totW.appendChild(totCell);
  card2.appendChild(foot);
  return card2;
}

/* update totals bar in left panel without full re-render */
function updateTotalsDisplay(){
  var t=totals();
  var el2=document.getElementById('_totSub'); if(el2)el2.textContent=fmt(t.sub);
  var el3=document.getElementById('_totIgv'); if(el3)el3.textContent=fmt(t.igv);
  var el4=document.getElementById('_totTot'); if(el4)el4.textContent=fmt(t.tot);
  var el5=document.getElementById('_totLet'); if(el5)el5.textContent=numLetras(t.tot)+' '+(S.mon==='S/'?'SOLES':'DOLARES');
}

/* ─── PREVIEW TAB ─── */
function renderPreview(){
  var w=el('div','');
  var bar=document.createElement('div');
  bar.style.cssText='background:white;border-bottom:1px solid #e2e8f0;padding:10px 14px;display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:52px;z-index:30;-webkit-transform:translateZ(0)';
  (function(){
    var pb=document.createElement('button');
    pb.textContent='🖨  Exportar / Imprimir PDF';
    pb.style.cssText='display:inline-flex;align-items:center;justify-content:center;font-weight:600;padding:10px 16px;border-radius:12px;cursor:pointer;font-size:13px;border:none;background:#0d3b6e;color:white';
    pb.addEventListener('click',function(){
      exportPDF();
    });
    bar.appendChild(pb);
  })();
  (function(){
    var sb=document.createElement('button');
    sb.textContent='💾  Guardar';
    sb.style.cssText='display:inline-flex;align-items:center;justify-content:center;font-weight:600;padding:10px 16px;border-radius:12px;cursor:pointer;font-size:13px;border:none;background:#2ab7a9;color:white';
    sb.addEventListener('click',guardar);
    bar.appendChild(sb);
  })();
  (function(){
    var eb=document.createElement('button');
    eb.textContent='✏️  Editar';
    eb.style.cssText='display:inline-flex;align-items:center;justify-content:center;font-weight:600;padding:10px 16px;border-radius:12px;cursor:pointer;font-size:13px;background:white;color:#334155;border:1px solid #e2e8f0';
    eb.addEventListener('click',function(){setState({tab:'cot'});});
    bar.appendChild(eb);
  })();
  bar.appendChild(el('span','marginLeft:auto;fontSize:11px;color:#64748b;display:flex;alignItems:center',['Imprimir → Guardar como PDF']));
  w.appendChild(bar);
  var dw=el('div','maxWidth:820px;margin:16px auto;boxShadow:0 4px 24px rgba(0,0,0,.1);borderRadius:12px;overflow:hidden;background:white');
  dw.appendChild(buildPDF());
  w.appendChild(dw);
  return w;
}

function buildPDF(){
  var t=totals(), cur=S.mon;
  var doc=el('div','background:white;position:relative');

  /* watermark */
  var wm=el('div','position:absolute;inset:0;display:flex;alignItems:center;justifyContent:center;pointerEvents:none;zIndex:0;overflow:hidden');
  var wimg=document.createElement('img'); wimg.src=LOGO; wimg.style.cssText='width:50%;opacity:.04;filter:grayscale(1)';
  wm.appendChild(wimg); doc.appendChild(wm);

  var pc=el('div','position:relative;zIndex:1');

  /* HEADER */
  var hdr=el('div','display:flex;justifyContent:space-between;alignItems:flex-start;padding:14px 20px 10px');
  var hL=el('div','');
  var logoImg=document.createElement('img'); logoImg.src=LOGO; logoImg.style.cssText='height:38px;marginBottom:5px;display:block';
  hL.appendChild(logoImg);
  [
    {b:1,v:EMP.ruc+' - '+EMP.nombre},
    {b:0,v:'RUC: '+EMP.ruc},
    {b:0,v:'Dom. Fiscal: '+EMP.dir},
    {b:0,v:'Urb. CALIFORNIA'},
    {b:0,v:'Telef. '+EMP.cel},
    {b:0,v:'Web: skyblueperuglobal.com'},
  ].forEach(function(r){
    hL.appendChild(el('div','fontSize:7.5px;color:#334155;fontWeight:'+(r.b?700:400)+';lineHeight:1.6',[r.v]));
  });
  hdr.appendChild(hL);

  var hR=el('div','display:flex;flexDirection:column;alignItems:flex-end;gap:8px');
  var isoImg=document.createElement('img'); isoImg.src=LISO; isoImg.style.cssText='height:50px;objectFit:contain';
  hR.appendChild(isoImg);

  var cb=el('div','border:1px solid #e2e8f0;borderRadius:4px;overflow:hidden;minWidth:230px');
  var cbr1=el('div','display:grid;gridTemplateColumns:1fr 1fr;borderBottom:1px solid #e2e8f0');
  var cbr1a=el('div','padding:4px 8px;background:#f8fafc;borderRight:1px solid #e2e8f0');
  cbr1a.appendChild(el('div','fontSize:6.5px;color:#64748b;textTransform:uppercase;letterSpacing:1px',['SISTEMA INTEGRADO DE GESTION']));
  cbr1a.appendChild(el('div','fontSize:9px;fontWeight:700',['SGC-FO-0579']));
  cbr1.appendChild(cbr1a); cbr1.appendChild(el('div','padding:4px 8px;background:#f8fafc'));
  var cbr2=el('div','display:grid;gridTemplateColumns:1fr 1fr');
  var cbr2a=el('div','padding:4px 8px;borderRight:1px solid #e2e8f0');
  cbr2a.appendChild(el('div','fontSize:6.5px;color:#64748b;textTransform:uppercase',['COTIZACION']));
  cbr2a.appendChild(el('div','fontSize:10px;fontWeight:700',['N\u00b0 '+S.num]));
  var cbr2b=el('div','padding:4px 8px');
  cbr2b.appendChild(el('div','fontSize:6.5px;color:#64748b;textTransform:uppercase',['VERSION']));
  cbr2b.appendChild(el('div','fontSize:10px;fontWeight:700',[S.ver.padStart(2,'0')]));
  cbr2.appendChild(cbr2a); cbr2.appendChild(cbr2b);
  cb.appendChild(cbr1); cb.appendChild(cbr2); hR.appendChild(cb);
  hdr.appendChild(hR); pc.appendChild(hdr);

  /* teal bar */
  var tbar=el('div','background:#2ab7a9;display:flex;alignItems:center;padding:0 20px;height:26px;gap:10px');
  tbar.appendChild(el('div','color:white;fontWeight:700;fontSize:11px',['COTIZACION']));
  var np=el('div','background:white;color:#0d3b6e;fontWeight:800;fontSize:11px;padding:2px 10px;borderRadius:3px',['N\u00b0'+S.num+'/SKY']);
  tbar.appendChild(np); pc.appendChild(tbar);

  /* client */
  var cs=el('div','padding:8px 20px;borderBottom:1px solid #e2e8f0;background:#fafafa;display:flex;justifyContent:space-between;gap:20px');
  var cL=el('div','display:grid;gridTemplateColumns:auto 1fr;gap:2px 8px;fontSize:8.5px;flex:1');
  [
    ['SEÑOR(ES):',(S.cli.ruc?S.cli.ruc+' - ':'')+S.cli.n,1],
    ['CONTACTO:',S.cli.con,0],['TELEFONO:',S.cli.tel,0],
    ['E-MAIL:',S.cli.mail,0],['DIRECCION:',S.cli.dir,0],
    ['CONCEPTO:',S.proy,0]
  ].forEach(function(r){
    cL.appendChild(el('div','fontWeight:700;color:#334155;whiteSpace:nowrap',[r[0]]));
    cL.appendChild(el('div','color:#1e293b;fontWeight:'+(r[2]?600:400),[r[1]||'']));
  });
  cs.appendChild(cL);
  var cR=el('div','textAlign:right;fontSize:8.5px;flexShrink:0');
  cR.appendChild(el('div','fontWeight:700;color:#334155',['FECHA: '+today()]));
  cR.appendChild(el('div','fontWeight:700;color:#334155;marginTop:2px',['PROYECTO: '+S.proy]));
  cs.appendChild(cR); pc.appendChild(cs);

  /* table */
  var tw=el('div','padding:0 20px 12px');
  var tbl=document.createElement('table');
  tbl.style.cssText='width:100%;borderCollapse:collapse;fontSize:9px;marginTop:8px';
  var thead=document.createElement('thead');
  var thr=document.createElement('tr');
  thr.style.cssText='background:#0d3b6e;color:white';
  ['LINEA','CODIGO','PRODUCTO / SERVICIO','UND','CANTIDAD','PRECIO UNITARIO','PRECIO TOTAL'].forEach(function(h,i){
    var th=document.createElement('th');
    th.style.cssText='padding:6px 5px;textAlign:'+(i>3?'right':i===3?'center':'left')+';fontSize:8px;fontWeight:700;letterSpacing:.3px;whiteSpace:nowrap';
    th.textContent=h; thr.appendChild(th);
  });
  thead.appendChild(thr); tbl.appendChild(thead);
  var tbody=document.createElement('tbody');
  S.items.forEach(function(it,i){
    var tot2=(it.qty||1)*(it.precio||0);
    var tr2=document.createElement('tr');
    tr2.style.cssText='background:'+(i%2===0?'white':'#f8fafc')+';borderBottom:1px solid #f0f4f8;verticalAlign:top';
    [
      [String(i+1),'textAlign:center;color:#64748b;fontSize:9px'],
      [(it.cod||it._prod&&it._prod.id||'\u2014'),'fontSize:9px;color:#2ab7a9;fontWeight:600;whiteSpace:nowrap'],
      ['desc','maxWidth:230px'],
      ['UND','textAlign:center;fontSize:9px;color:#64748b'],
      [String(it.qty||1),'textAlign:center;fontSize:9px;fontWeight:600'],
      [fmt(it.precio||0,cur),'textAlign:right;fontSize:9px'],
      [fmt(tot2,cur),'textAlign:right;fontSize:9px;fontWeight:700']
    ].forEach(function(td,ti){
      var cell=document.createElement('td');
      cell.style.cssText='padding:7px 4px;'+(td[1]||'');
      if(ti===2){
        cell.appendChild(el('div','fontWeight:600;fontSize:9px;lineHeight:1.4',[it.desc||'—']));
        if(it._prod){
          var dg=el('div','marginTop:2px;display:grid;gridTemplateColumns:auto 1fr;gap:1px 5px;fontSize:8px');
          [['Tipo',it._prod.c],['Marca',it._prod.p]].forEach(function(kv){
            dg.appendChild(el('div','color:#64748b;fontWeight:600;whiteSpace:nowrap',[kv[0]+' :']));
            dg.appendChild(el('div','color:#334155',[kv[1]||'']));
          });
          cell.appendChild(dg);
        }
      } else {
        cell.textContent=td[0];
      }
      tr2.appendChild(cell);
    });
    tbody.appendChild(tr2);
  });
  tbl.appendChild(tbody); tw.appendChild(tbl);

  /* totals */
  var ts=el('div','display:flex;justifyContent:space-between;alignItems:flex-end;marginTop:8px;paddingTop:8px;borderTop:2px solid #e2e8f0');
  ts.appendChild(el('div','flex:1;paddingRight:20px',[
    el('div','fontSize:8.5px;fontWeight:700;color:#334155',['Son: '+numLetras(t.tot)+' '+(cur==='S/'?'SOLES':'DOLARES AMERICANOS')])
  ]));
  var nd=el('div','textAlign:right;minWidth:165px');
  var ng=el('div','display:grid;gridTemplateColumns:1fr auto;gap:2px 12px;fontSize:10px;alignItems:center');
  [['Sub Total:',fmt(t.sub,cur)],['IGV:',fmt(t.igv,cur)]].forEach(function(r){
    ng.appendChild(el('div','textAlign:right;color:#64748b',[r[0]]));
    ng.appendChild(el('div','textAlign:right;fontWeight:600',[r[1]]));
  });
  nd.appendChild(ng);
  var totFin2=el('div','display:flex;justifyContent:space-between;marginTop:6px;padding:7px 10px;background:#0d3b6e;borderRadius:6px');
  totFin2.appendChild(el('div','color:white;fontWeight:700;fontSize:12px',['Total: '+cur]));
  totFin2.appendChild(el('div','color:#2ab7a9;fontWeight:800;fontSize:12px',[fmt(t.tot,cur)]));
  nd.appendChild(totFin2);
  ts.appendChild(nd); tw.appendChild(ts);

  /* condiciones + firma */
  var fs=el('div','marginTop:12px;paddingTop:10px;borderTop:1px solid #e2e8f0');

  /* Condiciones comerciales */
  var conds=el('div','marginBottom:10px');
  conds.appendChild(el('div','fontWeight:700;color:#334155;textTransform:uppercase;fontSize:7.5px;letterSpacing:.5px;marginBottom:4px',['Condiciones Comerciales']));
  var condGrid=el('div','display:grid;gridTemplateColumns:1fr 1fr;gap:2px 20px;fontSize:8px;color:#334155');
  [
    ['Forma de pago:', S.pago],
    ['Tiempo de entrega:', S.entr],
    ['Validez de la oferta:', S.valid],
    ['Lugar de entrega:', S.cli.dir||'A coordinar con el cliente'],
    ['Moneda:', S.mon==='S/'?'Soles (S/) incluye IGV 18%':'Dolares (US$) incluye IGV'],
    ['Garantia:', '12 meses contra defectos de fabricacion'],
    ['Soporte tecnico:', 'Incluido durante el periodo de garantia'],
    ['Facturacion electronica:', 'SKY BLUE PERU S.A.C. — RUC '+EMP.ruc],
  ].forEach(function(r){
    condGrid.appendChild(el('div','fontWeight:700;whiteSpace:nowrap;paddingTop:2px',[r[0]]));
    condGrid.appendChild(el('div','color:#475569;paddingTop:2px',[r[1]]));
  });
  conds.appendChild(condGrid);
  fs.appendChild(conds);

  /* Datos pago + firma */
  var row2=el('div','display:flex;gap:20px;paddingTop:8px;borderTop:1px solid #e2e8f0;flexWrap:wrap');

  var bd=el('div','fontSize:8.5px;flex:1');
  bd.appendChild(el('div','fontWeight:700;color:#334155;marginBottom:3px;textTransform:uppercase;fontSize:7.5px',['Datos de Pago']));
  bd.appendChild(el('div','fontWeight:700',[EMP.banco]));
  bd.appendChild(el('div','color:#64748b',['CCI: '+EMP.cci]));
  bd.appendChild(el('div','color:#64748b',['Titular: '+EMP.nombre]));
  bd.appendChild(el('div','color:#64748b;marginTop:3px',['Correo: '+EMP.email]));
  bd.appendChild(el('div','color:#64748b',['Telef.: '+EMP.cel]));
  row2.appendChild(bd);

  var fd=el('div','fontSize:8.5px;textAlign:center');
  fd.appendChild(el('div','fontWeight:700;color:#334155;marginBottom:3px;textTransform:uppercase;fontSize:7.5px',['Firma y Sello']));
  fd.appendChild(el('div','width:140px;height:42px;borderBottom:1px solid #334155;marginBottom:3px;margin:0 auto 3px'));
  fd.appendChild(el('div','fontSize:8px;color:#334155;fontWeight:600',['SKY BLUE PERU S.A.C.']));
  fd.appendChild(el('div','fontSize:8px;color:#64748b',['RUC: '+EMP.ruc]));
  row2.appendChild(fd);

  fs.appendChild(row2);
  tw.appendChild(fs);

  /* footer logos */
  var fl=el('div','borderTop:3px solid #2ab7a9;padding:8px 20px 6px;background:#f8fafc');
  var provImg=document.createElement('img'); provImg.src=LPROV;
  provImg.style.cssText='width:100%;height:32px;objectFit:contain;objectPosition:center;display:block';
  fl.appendChild(provImg);
  fl.appendChild(el('div','textAlign:right;fontSize:7.5px;color:#94a3b8;marginTop:3px',['Pag. 1 / 1']));
  tw.appendChild(fl); pc.appendChild(tw); doc.appendChild(pc);
  return doc;
}

/* ─── HISTORIAL ─── */
function renderHist(){
  var w=el('div','max-width:900px;margin:0 auto;padding:14px 12px');

  var h2=document.createElement('div');
  h2.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px';
  h2.appendChild(el('div','font-size:15px;font-weight:700',['Historial de Cotizaciones']));
  var hacts=document.createElement('div');
  hacts.style.cssText='display:flex;gap:8px;align-items:center';
  hacts.appendChild(chipEl(S.hist.length+' guardadas','cs'));
  if(S.hist.length){
    var clrBtn=document.createElement('button');
    clrBtn.textContent='Limpiar todo';
    clrBtn.style.cssText='background:white;color:#334155;border:1px solid #e2e8f0;padding:6px 10px;font-size:12px;border-radius:10px;cursor:pointer;font-weight:600';
    clrBtn.addEventListener('click',function(){if(confirm('Limpiar todo el historial?'))setState({hist:[]});});
    hacts.appendChild(clrBtn);
  }
  h2.appendChild(hacts);
  w.appendChild(h2);

  if(!S.hist.length){
    var em=card();
    em.style.cssText+='padding:50px 20px;text-align:center;color:#94a3b8';
    em.appendChild(el('div','font-size:36px;margin-bottom:8px',['📋']));
    em.appendChild(el('div','',['No hay cotizaciones guardadas.']));
    w.appendChild(em); return w;
  }

  S.hist.forEach(function(c,ci){
    var cd=document.createElement('div');
    cd.style.cssText='background:white;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:10px';

    /* top row: info + amount */
    var topRow=document.createElement('div');
    topRow.style.cssText='display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap';

    var inf=document.createElement('div');
    inf.style.cssText='flex:1;min-width:180px';

    var badgeRow=document.createElement('div');
    badgeRow.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px';
    badgeRow.appendChild(el('span','font-size:14px;font-weight:700;color:#0d3b6e',['COT-'+c.num]));
    badgeRow.appendChild(chipEl('v'+(c.ver||'00'),'cs'));
    badgeRow.appendChild(chipEl(c.mon||'S/',c.mon==='S/'?'ct':'cg'));
    inf.appendChild(badgeRow);
    inf.appendChild(el('div','font-size:13px;font-weight:600',[(c.cli&&c.cli.n)||'Sin cliente']));
    inf.appendChild(el('div','font-size:11px;color:#94a3b8;margin-top:2px',
      [c.fecha+' \u00b7 '+(c.user||'').split('-')[0].trim()]));
    if(c.proy)inf.appendChild(el('div','font-size:11px;color:#0d3b6e;margin-top:2px',[c.proy]));
    topRow.appendChild(inf);

    var right=document.createElement('div');
    right.style.cssText='text-align:right;flex-shrink:0';
    right.appendChild(el('div','font-size:16px;font-weight:700',[fmt(c.tot||0,c.mon)]));
    right.appendChild(el('div','font-size:11px;color:#94a3b8;margin-top:2px',
      [(c.items&&c.items.length||0)+' productos']));
    topRow.appendChild(right);
    cd.appendChild(topRow);

    /* action buttons */
    var acts=document.createElement('div');
    acts.style.cssText='display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9;flex-wrap:wrap';

    /* Load into editor */
    var loadBtn=document.createElement('button');
    loadBtn.textContent='✏️  Abrir y editar';
    loadBtn.style.cssText='flex:1;min-width:130px;display:flex;align-items:center;justify-content:center;font-weight:600;padding:8px 12px;border-radius:10px;cursor:pointer;font-size:12px;background:#f0fdfa;color:#0f766e;border:1px solid #ccfbf1';
    (function(cotSnap){
      loadBtn.addEventListener('click',function(){
        if(!confirm('Cargar COT-'+cotSnap.num+' para editar? Se reemplaza la cotizacion actual.'))return;
        S.items=cotSnap.items||[];
        S.cli=Object.assign({},cotSnap.cli||{});
        S.num=cotSnap.num||'001';
        S.ver=cotSnap.ver||'00';
        S.proy=cotSnap.proy||'';
        S.mon=cotSnap.mon||'S/';
        S.pago=cotSnap.pago||'Contado';
        S.entr=cotSnap.entr||'Inmediato';
        S.valid=cotSnap.valid||'15 dias calendario';
        setState({tab:'cot'});
      });
    })(c);
    acts.appendChild(loadBtn);

    /* Download PDF */
    var dlBtn=document.createElement('button');
    dlBtn.textContent='📄  Descargar PDF';
    dlBtn.style.cssText='flex:1;min-width:130px;display:flex;align-items:center;justify-content:center;font-weight:600;padding:8px 12px;border-radius:10px;cursor:pointer;font-size:12px;background:#0d3b6e;color:white;border:none';
    (function(cotSnap){
      dlBtn.addEventListener('click',function(){
        exportHistPDF(cotSnap);
      });
    })(c);
    acts.appendChild(dlBtn);

    /* Delete */
    var delBtn=document.createElement('button');
    delBtn.textContent='🗑';
    delBtn.style.cssText='width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:10px;cursor:pointer;background:#fef2f2;color:#f87171;border:1px solid #fecaca';
    (function(idx2){
      delBtn.addEventListener('click',function(){
        if(confirm('Eliminar COT-'+S.hist[idx2].num+'?')){
          var nh=S.hist.filter(function(_,i){return i!==idx2;});
          setState({hist:nh});
        }
      });
    })(ci);
    acts.appendChild(delBtn);

    cd.appendChild(acts);
    w.appendChild(cd);
  });
  return w;
}

/* ─── CATALOGO ─── */
var _catQ='', _catCat='Todos';
function renderCat(){
  var w=el('div','maxWidth:900px;margin:0 auto;padding:14px 12px');
  var stk=el('div','position:sticky;top:52px;background:#eef2f7;paddingBottom:10px;zIndex:20');
  var sr=el('div','display:flex;gap:8px;marginBottom:8px');
  var si=document.createElement('input');
  si.type='text'; si.placeholder='Buscar producto, codigo, proveedor...';
  si.value=_catQ;
  si.style.cssText='flex:1;fontSize:14px;border:1px solid #e2e8f0;borderRadius:12px;padding:11px 16px;outline:none;background:white;boxSizing:border-box';
  si.onfocus=function(){si.style.borderColor='#2ab7a9';};
  si.onblur=function(){si.style.borderColor='#e2e8f0';};
  var catDeb=null;
  si.oninput=function(){ _catQ=si.value; clearTimeout(catDeb); catDeb=setTimeout(function(){updateCatList(list,_catQ,_catCat);},150); };
  sr.appendChild(si);
  sr.appendChild(btn2('+ Nuevo','background:#ecfdf5;color:#059669;border:1px solid #a7f3d0',function(){setState({modal:'add'});}));
  stk.appendChild(sr);
  var pills=el('div','display:flex;gap:6px;overflowX:auto;paddingBottom:2px');
  pills.style.msOverflowStyle='none'; pills.style.scrollbarWidth='none';
  allCats().forEach(function(c){
    var on=_catCat===c;
    var p=document.createElement('button');
    p.textContent=c;
    p.style.cssText='flexShrink:0;fontSize:9px;fontWeight:700;letterSpacing:1.5px;textTransform:uppercase;padding:5px 10px;borderRadius:999px;cursor:pointer;border:'+(on?'none':'1px solid #e2e8f0')+';background:'+(on?'#2ab7a9':'white')+';color:'+(on?'white':'#64748b');
    p.onclick=function(){ _catCat=c; updateCatList(list,_catQ,_catCat); pills.querySelectorAll('button').forEach(function(b,i){var cc=allCats()[i];b.style.background=cc===c?'#2ab7a9':'white';b.style.color=cc===c?'white':'#64748b';b.style.border=cc===c?'none':'1px solid #e2e8f0';}); };
    pills.appendChild(p);
  });
  stk.appendChild(pills); w.appendChild(stk);
  var cnt=el('div','fontSize:11px;color:#94a3b8;margin:6px 0 10px','');
  w.appendChild(cnt);
  var list=el('div','');
  w.appendChild(list);
  updateCatList(list,_catQ,_catCat,cnt);
  return w;
}

function updateCatList(list,q,cat2,cnt){
  var ql=(q||'').toLowerCase();
  var res=catalog().filter(function(p){
    return (cat2==='Todos'||p.c===cat2)&&(p.n.toLowerCase().includes(ql)||p.id.toLowerCase().includes(ql)||p.p.toLowerCase().includes(ql));
  });
  if(cnt)cnt.textContent=res.length+' productos \u00b7 '+catalog().length+' total';
  list.innerHTML='';
  res.forEach(function(p){
    var rw=el('div','background:white;borderRadius:12px;border:1px solid #e2e8f0;padding:11px 14px;display:flex;gap:12px;alignItems:flex-start;marginBottom:8px');
    var inf=el('div','flex:1;minWidth:0');
    inf.appendChild(el('div','fontSize:13px;fontWeight:500;color:#1e293b;lineHeight:1.4;marginBottom:5px',[p.n]));
    inf.appendChild(el('div','display:flex;gap:4px;flexWrap:wrap',[chipEl(p.id,'cs'),chipEl(p.p,p.p==='MERINSA'?'cg':p.p==='JAMPAR'?'cb':'ct'),chipEl(p.c,'cs')]));
    rw.appendChild(inf);
    var pv=el('div','textAlign:right;flexShrink:0');
    pv.appendChild(p.v>0?el('div','fontSize:13px;fontWeight:700;color:#1e293b',[fmt(p.v)]):el('div','fontSize:11px;color:#94a3b8;fontStyle:italic',['A consultar']));
    rw.appendChild(pv); list.appendChild(rw);
  });
}

/* ─── COMPRAS TAB ─── */
function renderCompras(){
  var w=el('div','maxWidth:900px;margin:0 auto;padding:14px 12px');
  var h2=el('div','display:flex;alignItems:center;justifyContent:space-between;marginBottom:14px',[
    el('div','fontSize:15px;fontWeight:700',['Compras de Proveedores']),
    btn2('+ Cargar cotizacion','background:#2ab7a9;color:white',function(){setState({modal:'compra'});})
  ]);
  w.appendChild(h2);

  /* info card */
  var info=card();
  info.style.background='#f0fdfa'; info.style.border='1px solid #ccfbf1';
  info.appendChild(el('div','fontSize:13px;color:#0f766e;fontWeight:600;marginBottom:6px',['Como funciona']));
  info.appendChild(el('div','fontSize:12px;color:#334155;lineHeight:1.7',[
    '1\ufe0f\u20e3  Carga el PDF o imagen de la cotizacion del proveedor.',el('br'),
    '2\ufe0f\u20e3  La IA extrae productos con su precio de compra.',el('br'),
    '3\ufe0f\u20e3  Pon tu precio de venta en la columna derecha.',el('br'),
    '4\ufe0f\u20e3  Agrega al catalogo o usa directo en tu cotizacion.'
  ]));
  w.appendChild(info);

  if(!S.compras.length){
    var em=card();
    em.style.cssText+='padding:50px 20px;textAlign:center;color:#94a3b8;marginTop:12px';
    em.appendChild(el('div','fontSize:36px;marginBottom:8px',['📄']));
    em.appendChild(el('div','',['No hay cotizaciones de proveedores cargadas aun.']));
    w.appendChild(em); return w;
  }

  S.compras.forEach(function(co,ci){
    var cd=card();
    var hd=el('div','display:flex;alignItems:center;justifyContent:space-between;marginBottom:10px;flexWrap:wrap;gap:8px');
    hd.appendChild(el('div','fontWeight:700;fontSize:14px;color:#0d3b6e',[co.prov||'Proveedor '+(ci+1)+' \u00b7 '+co.fecha]));
    var acts=el('div','display:flex;gap:6px;flexWrap:wrap');
    (function(cIdx){
      acts.appendChild(btn2('Agregar al catalogo','background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;fontSize:12px;padding:6px 10px',function(){
        var added=co.items.map(function(it){
          return{id:it.cod||uid(),p:co.prov||'PROVEEDOR',c:it.tipo||'COMPRA',n:it.nombre,v:it.precio_venta||it.precio_compra||0};
        });
        S.extra=S.extra.concat(added);
        saveS(); buildIdx();
        alert('\u2705 '+added.length+' productos agregados al catalogo');
        renderApp();
      }));
      acts.appendChild(btn2('Usar en cotizacion','background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;fontSize:12px;padding:6px 10px',function(){
        var newItems=co.items.map(function(it){
          return{id:uid(),cod:it.cod||'',desc:it.nombre,qty:it.qty||1,precio:it.precio_venta||it.precio_compra||0,_prod:null};
        });
        S.items=S.items.filter(function(i){return i.desc||i._prod;}).concat(newItems);
        saveS();
        setState({tab:'cot'});
      }));
      acts.appendChild(btn2('\u00d7 Eliminar','background:#fef2f2;color:#f87171;border:1px solid #fecaca;fontSize:12px;padding:6px 10px',function(){
        if(confirm('Eliminar esta cotizacion de compra?')){
          S.compras=S.compras.filter(function(_,i){return i!==cIdx;});
          saveS(); renderApp();
        }
      }));
    })(ci);
    hd.appendChild(acts); cd.appendChild(hd);

    /* table */
    var tbl=document.createElement('table');
    tbl.style.cssText='width:100%;borderCollapse:collapse;fontSize:12px';
    var thead2=document.createElement('thead');
    var thr2=document.createElement('tr');
    thr2.style.cssText='background:#f8fafc;borderBottom:1px solid #e2e8f0';
    ['Codigo','Nombre / Descripcion','Cant.','P. Compra','P. Venta (editable)'].forEach(function(h){
      var th=document.createElement('th');
      th.style.cssText='padding:6px 8px;textAlign:left;fontSize:10px;fontWeight:700;color:#64748b;textTransform:uppercase;letterSpacing:.5px';
      th.textContent=h; thr2.appendChild(th);
    });
    thead2.appendChild(thr2); tbl.appendChild(thead2);
    var tbody2=document.createElement('tbody');
    co.items.forEach(function(it,ii){
      var row=document.createElement('tr');
      row.style.cssText='borderBottom:1px solid #f8fafc;background:'+(ii%2===0?'white':'#fafafa');
      var cells=[
        {t:it.cod||'\u2014',s:'fontFamily:monospace;fontSize:11px;color:#2ab7a9;padding:6px 8px'},
        {t:it.nombre,s:'padding:6px 8px;maxWidth:240px;fontSize:12px'},
        {t:String(it.qty||1),s:'padding:6px 8px;textAlign:right;fontWeight:600'},
        {t:it.precio_compra?fmt(it.precio_compra,'S/'):'—',s:'padding:6px 8px;textAlign:right;color:#64748b'}
      ];
      cells.forEach(function(c2){var td=document.createElement('td');td.style.cssText=c2.s;td.textContent=c2.t;row.appendChild(td);});
      /* editable price cell */
      var ptd=document.createElement('td');
      ptd.style.cssText='padding:4px 8px;textAlign:right';
      var pi=document.createElement('input');
      pi.type='number'; pi.min='0'; pi.step='0.01';
      pi.value=String(it.precio_venta||'');
      pi.placeholder='0.00';
      pi.style.cssText='width:90px;fontSize:13px;fontWeight:700;color:#0d3b6e;border:1px solid #e2e8f0;borderRadius:6px;padding:4px 8px;textAlign:right;outline:none;boxSizing:border-box';
      pi.onfocus=function(){pi.style.borderColor='#2ab7a9';};
      pi.onblur=function(){pi.style.borderColor='#e2e8f0';};
      (function(cIdx,iIdx){
        pi.onchange=function(){
          S.compras=S.compras.map(function(co2,ci2){
            if(ci2!==cIdx)return co2;
            var ni2=co2.items.map(function(it2,ii2){
              if(ii2!==iIdx)return it2;
              return Object.assign({},it2,{precio_venta:parseFloat(pi.value)||0});
            });
            return Object.assign({},co2,{items:ni2});
          });
          saveS();
        };
      })(ci,ii);
      ptd.appendChild(pi); row.appendChild(ptd);
      tbody2.appendChild(row);
    });
    tbl.appendChild(tbody2); cd.appendChild(tbl);
    w.appendChild(cd);
  });
  return w;
}

/* ─── MODAL: ADD PRODUCT ─── */
function modalAdd(){
  var f={id:'',p:'OTRO',c:'',n:'',v:''};
  var ov=overlay();
  ov.onclick=function(e){if(e.target===ov)setState({modal:null});};
  var dl=dialog();
  dl.appendChild(el('div','fontSize:14px;fontWeight:700;marginBottom:16px',['Agregar Producto al Catalogo']));
  var fs=el('div','display:flex;flexDirection:column;gap:12px');
  function af(l,k,ph,tp){
    var w=el('div','');
    w.appendChild(el('span','fontSize:10px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;display:block;marginBottom:4px',[l]));
    var i=document.createElement('input'); i.type=tp||'text'; i.placeholder=ph||'';
    i.style.cssText='border:none;borderBottom:1px solid #e2e8f0;background:transparent;color:#1e293b;padding:5px 0;outline:none;width:100%;fontSize:14px;boxSizing:border-box';
    i.onfocus=function(){i.style.borderBottomColor='#2ab7a9';};
    i.onblur=function(){i.style.borderBottomColor='#e2e8f0';};
    i.oninput=function(){f[k]=i.value;};
    w.appendChild(i); return w;
  }
  var g=el('div','display:grid;gridTemplateColumns:1fr 1fr;gap:10px');
  g.appendChild(af('Codigo *','id','HTL-XXX'));
  g.appendChild(af('Proveedor','p','HIDROTEK'));
  fs.appendChild(g);
  fs.appendChild(af('Categoria','c','FILTRO CARTUCHO'));
  fs.appendChild(af('Nombre / Descripcion *','n','Descripcion completa del producto'));
  fs.appendChild(af('Precio S/ (venta)','v','0.00','number'));
  dl.appendChild(fs);
  var br=el('div','display:flex;gap:8px;marginTop:16px');
  br.appendChild(btn2('Guardar','background:#2ab7a9;color:white;flex:1',function(){
    if(!f.id||!f.n){alert('Completa codigo y nombre');return;}
    var np={id:f.id,p:f.p||'OTRO',c:f.c||'OTROS',n:f.n,v:parseFloat(f.v)||0};
    S.extra=S.extra.concat([np]);
    saveS(); buildIdx();
    setState({modal:null});
    alert('\u2705 Producto "'+np.n+'" agregado al catalogo');
  }));
  br.appendChild(btn2('Cancelar','background:white;color:#334155;border:1px solid #e2e8f0',function(){setState({modal:null});}));
  dl.appendChild(br); ov.appendChild(dl); return ov;
}

/* ─── MODAL: IMPORTAR COTIZACION DEL PROVEEDOR ─── */
/* Un solo flujo: subir PDF/imagen -> extraer productos -> editar precio venta -> insertar en cotizacion */
function modalImport(){
  var _prov='', _items=[], _online=navigator.onLine;
  var ov=overlay();
  ov.onclick=function(e){if(e.target===ov)setState({modal:null});};
  var dl=dialog();
  dl.style.maxWidth='560px';

  dl.appendChild(el('div','display:flex;justify-content:space-between;align-items:center;margin-bottom:12px',[
    el('div','font-size:15px;font-weight:700',['Cargar cotizacion del proveedor']),
    btn2('\u00d7','background:none;border:none;font-size:22px;color:#94a3b8',function(){setState({modal:null});})
  ]));

  /* paso explicativo */
  dl.appendChild(el('div','background:#f0fdfa;border-radius:10px;padding:10px 12px;font-size:12px;color:#0f766e;margin-bottom:12px;line-height:1.6',
    ['Sube el PDF o imagen de la cotizacion que te enviaron. Se extraen automaticamente los productos con sus detalles. Tu solo cambias el precio de venta y se agregan a tu cotizacion.']));

  /* proveedor */
  var pw=el('div','margin-bottom:12px');
  pw.appendChild(el('span','font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;display:block;margin-bottom:4px',['Proveedor (opcional)']));
  var pin=document.createElement('input');
  pin.type='text'; pin.placeholder='Ej: MERINSA, HIDROTEK, JAMPAR...';
  pin.style.cssText='border:none;border-bottom:1px solid #e2e8f0;background:transparent;color:#1e293b;padding:5px 0;outline:none;width:100%;font-size:14px;box-sizing:border-box';
  pin.oninput=function(){_prov=pin.value;};
  pw.appendChild(pin);
  dl.appendChild(pw);

  /* status conexion */
  var netNote=el('div','font-size:11px;padding:6px 10px;border-radius:8px;margin-bottom:10px;text-align:center',
    [_online?'Con internet: extraccion automatica con IA activada':'Sin internet: se usara extraccion local (codigos del catalogo)']);
  netNote.style.background=_online?'#ecfdf5':'#f1f5f9';
  netNote.style.color=_online?'#059669':'#64748b';
  dl.appendChild(netNote);

  /* drop zone con input file por encima (patron Safari) */
  var dz=el('div','position:relative;border:2px dashed #e2e8f0;border-radius:14px;padding:26px 20px;text-align:center;background:#f8fafc;margin-bottom:12px');
  var fi=document.createElement('input');
  fi.type='file';
  fi.accept='application/pdf,image/png,image/jpeg,image/jpg,image/webp';
  fi.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:3';
  dz.appendChild(fi);
  dz.appendChild(el('div','font-size:32px;margin-bottom:8px;pointer-events:none',['\ud83d\udcce']));
  dz.appendChild(el('div','font-size:14px;font-weight:600;color:#334155;pointer-events:none',['Toca para subir PDF o imagen']));
  dz.appendChild(el('div','font-size:12px;color:#64748b;margin-top:4px;pointer-events:none',['o arrastra el archivo aqui']));
  dl.appendChild(dz);

  var statusEl=el('div','font-size:12px;color:#64748b;text-align:center;min-height:18px;margin-bottom:8px','');
  dl.appendChild(statusEl);

  var resultDiv=el('div','');
  dl.appendChild(resultDiv);

  /* ── procesar archivo ── */
  function handleFile(file){
    if(!file)return;
    var isImg=file.type.indexOf('image/')===0;
    var isPDF=file.type==='application/pdf';
    if(!isImg&&!isPDF){statusEl.textContent='Solo PDF o imagenes (PNG, JPG).';return;}
    dz.style.borderColor='#2ab7a9'; dz.style.background='#f0fdfa';

    if(!navigator.onLine){
      statusEl.textContent='Sin internet: no se puede leer el archivo. Conectate para extraer.';
      dz.style.borderColor='#e2e8f0'; dz.style.background='#f8fafc';
      return;
    }

    statusEl.textContent='Leyendo archivo...';
    var reader=new FileReader();
    reader.onerror=function(){statusEl.textContent='Error leyendo el archivo.';};
    reader.onload=function(ev){
      var b64=String(ev.target.result).split(',')[1];
      statusEl.textContent='Analizando con IA, espera unos segundos...';
      var content=[
        {type:isPDF?'document':'image',source:{type:'base64',media_type:file.type,data:b64}},
        {type:'text',text:'Eres un extractor de datos de cotizaciones. Analiza este documento y extrae TODOS los productos de la tabla. Responde UNICAMENTE con un JSON array valido, sin markdown ni texto extra. Cada objeto: {"cod":"codigo","nombre":"descripcion completa del producto","tipo":"tipo/categoria","marca":"marca","modelo":"modelo","procedencia":"pais","qty":cantidad_numero,"precio_compra":precio_unitario_numero}. Si un campo falta usa "" o 0. Extrae TODOS los items aunque sean muchos.'}
      ];
      fetch(getAPIUrl(),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:3000,messages:[{role:'user',content:content}]})
      }).then(function(r){return r.json();}).then(function(data){
        var tx=(data&&data.content&&data.content[0]&&data.content[0].text)||'';
        var m=tx.match(/\[[\s\S]*\]/);
        if(m){
          try{
            var arr=JSON.parse(m[0]);
            _items=arr.map(function(p){
              return{
                cod:String(p.cod||''),nombre:String(p.nombre||''),tipo:String(p.tipo||''),
                marca:String(p.marca||''),modelo:String(p.modelo||''),procedencia:String(p.procedencia||''),
                qty:Number(p.qty)||1,precio_compra:Number(p.precio_compra)||0,precio_venta:Number(p.precio_compra)||0
              };
            });
            if(_items.length)showResult();
            else statusEl.textContent='No se detectaron productos. Intenta con otra foto mas clara.';
          }catch(e){statusEl.textContent='Error al interpretar. Intenta de nuevo.';}
        }else{statusEl.textContent='No se encontraron productos en el documento.';}
      }).catch(function(){
        statusEl.textContent='Error de conexion. Revisa tu internet e intenta de nuevo.';
        dz.style.borderColor='#e2e8f0'; dz.style.background='#f8fafc';
      });
    };
    reader.readAsDataURL(file);
  }

  /* ── mostrar resultados editables ── */
  function showResult(){
    statusEl.textContent='\u2705 '+_items.length+' productos extraidos. Edita el precio de venta:';
    resultDiv.innerHTML='';
    var list=el('div','max-height:320px;overflow-y:auto;margin-bottom:12px');
    _items.forEach(function(it,ix){
      var c=el('div','border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px;background:#f8fafc');
      c.appendChild(el('div','font-size:12px;font-weight:600;color:#1e293b;line-height:1.4;margin-bottom:4px',[it.nombre||'Producto '+(ix+1)]));
      var tags=el('div','display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px');
      if(it.cod)tags.appendChild(chipEl(it.cod,'cs'));
      if(it.marca)tags.appendChild(chipEl(it.marca,'ct'));
      if(it.tipo)tags.appendChild(chipEl(it.tipo,'cs'));
      c.appendChild(tags);
      var row=el('div','display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:end');
      /* cantidad */
      var qw=el('div','');
      qw.appendChild(el('div','font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px',['Cant.']));
      var qi=document.createElement('input');
      qi.type='number'; qi.min='1'; qi.value=String(it.qty||1);
      qi.style.cssText='width:100%;font-size:13px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;padding:6px;outline:none;box-sizing:border-box';
      (function(i2){qi.onchange=function(){_items[i2].qty=Math.max(1,parseFloat(qi.value)||1);};})(ix);
      qw.appendChild(qi);
      /* precio compra (solo lectura) */
      var cw=el('div','');
      cw.appendChild(el('div','font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px',['P. Compra']));
      cw.appendChild(el('div','font-size:13px;color:#64748b;border:1px solid #f1f5f9;border-radius:8px;padding:6px;text-align:right;background:#f1f5f9',[it.precio_compra?fmt(it.precio_compra):'—']));
      /* precio venta (editable) */
      var vw=el('div','');
      vw.appendChild(el('div','font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#0f766e;margin-bottom:2px',['P. Venta']));
      var vi=document.createElement('input');
      vi.type='number'; vi.min='0'; vi.step='0.01'; vi.value=String(it.precio_venta||'');
      vi.placeholder='0.00';
      vi.style.cssText='width:100%;font-size:13px;font-weight:700;color:#0f766e;text-align:right;border:1px solid #ccfbf1;border-radius:8px;padding:6px;outline:none;background:#f0fdfa;box-sizing:border-box';
      (function(i2){vi.onchange=function(){_items[i2].precio_venta=parseFloat(vi.value)||0;};})(ix);
      vw.appendChild(vi);
      row.appendChild(qw); row.appendChild(cw); row.appendChild(vw);
      c.appendChild(row);
      list.appendChild(c);
    });
    resultDiv.appendChild(list);

    var addBtn=document.createElement('button');
    addBtn.textContent='\u2705  Agregar '+_items.length+' productos a mi cotizacion';
    addBtn.style.cssText='display:flex;align-items:center;justify-content:center;font-weight:600;padding:12px 16px;border-radius:12px;cursor:pointer;font-size:14px;border:none;background:#2ab7a9;color:white;width:100%';
    addBtn.addEventListener('click',function(){
      var newItems=_items.map(function(it){
        var fullDesc=it.nombre;
        var prodObj={
          id:it.cod||uid(),p:_prov||it.marca||'PROVEEDOR',c:it.tipo||'IMPORTADO',
          n:it.nombre,v:it.precio_venta||0
        };
        return{id:uid(),cod:it.cod||'',desc:fullDesc,qty:it.qty||1,precio:it.precio_venta||0,_prod:prodObj};
      });
      /* quitar items vacios actuales y agregar los nuevos */
      S.items=S.items.filter(function(i){return i.desc||i._prod;}).concat(newItems);
      /* tambien guardar en catalogo para reuso futuro */
      var nuevosCat=_items.filter(function(it){return it.cod;}).map(function(it){
        return{id:it.cod,p:_prov||it.marca||'PROVEEDOR',c:it.tipo||'IMPORTADO',n:it.nombre,v:it.precio_venta||0};
      });
      var existIds={};
      catalog().forEach(function(p){existIds[p.id]=1;});
      var toAdd=nuevosCat.filter(function(p){return !existIds[p.id];});
      if(toAdd.length){S.extra=S.extra.concat(toAdd);buildIdx();}
      saveS();
      setState({modal:null,tab:'cot'});
      alert('\u2705 '+newItems.length+' productos agregados a tu cotizacion');
    });
    resultDiv.appendChild(addBtn);
  }

  fi.addEventListener('change',function(e){if(e.target.files&&e.target.files[0])handleFile(e.target.files[0]);});
  dz.addEventListener('dragover',function(e){e.preventDefault();dz.style.borderColor='#2ab7a9';dz.style.background='#f0fdfa';});
  dz.addEventListener('dragleave',function(){dz.style.borderColor='#e2e8f0';dz.style.background='#f8fafc';});
  dz.addEventListener('drop',function(e){e.preventDefault();if(e.dataTransfer.files&&e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);});

  ov.appendChild(dl); return ov;
}

/* ─── UI PRIMITIVE HELPERS ─── */
function el(tag,css,kids){
  var e=document.createElement(tag);
  if(css){
    /* convert camelCase object-style or raw string */
    css.split(';').forEach(function(rule){
      var parts=rule.split(':');
      if(parts.length>=2){
        var k=parts[0].trim();
        var v=parts.slice(1).join(':').trim();
        if(k)e.style[k]=v;
      }
    });
  }
  if(kids){
    if(!Array.isArray(kids))kids=[kids];
    kids.forEach(function(c){
      if(c==null||c===false)return;
      if(typeof c==='string')e.appendChild(document.createTextNode(c));
      else if(c.nodeType)e.appendChild(c);
    });
  }
  return e;
}
function card(){
  var d=document.createElement('div');
  d.style.cssText='background:white;borderRadius:14px;border:1px solid #e2e8f0;boxShadow:0 1px 4px rgba(0,0,0,.06);padding:16px;marginBottom:12px';
  return d;
}
function stitle(t){
  return el('div','fontSize:10px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;marginBottom:12px',[t]);
}
function chipEl(t,c){
  var s=document.createElement('span');
  s.className='chip '+c; s.textContent=t; return s;
}
function btn(label,cls,full,fn){
  var b=document.createElement('button');
  b.textContent=label;
  b.className='btn '+cls+(full?' bf':'');
  b.onclick=fn; return b;
}
function btn2(label,css,fn){
  var b=document.createElement('button');
  b.textContent=label;
  b.style.cssText='display:inline-flex;align-items:center;justify-content:center;font-weight:600;padding:10px 16px;border-radius:12px;cursor:pointer;font-size:13px;border:none;'+css;
  b.onclick=fn; return b;
}
function btnSmall(label,color,fn){
  var b=document.createElement('button');
  b.textContent=label;
  b.style.cssText='fontSize:12px;fontWeight:700;color:'+color+';background:none;border:none;cursor:pointer';
  b.onclick=fn; return b;
}
function fieldEl(lbl,val,fn,opts){
  opts=opts||{};
  var w=document.createElement('div');
  w.appendChild(el('span','fontSize:10px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;display:block;marginBottom:4px',[lbl]));
  var i=document.createElement('input');
  i.type=opts.type||'text'; i.value=val||''; i.placeholder=opts.ph||'';
  i.style.cssText='border:none;borderBottom:1px solid #e2e8f0;background:transparent;color:#1e293b;padding:5px 0;outline:none;width:100%;fontSize:14px;boxSizing:border-box';
  i.onfocus=function(){i.style.borderBottomColor='#2ab7a9';};
  i.onblur=function(){i.style.borderBottomColor='#e2e8f0';};
  i.oninput=function(){fn(i.value);};
  w.appendChild(i); return w;
}
function selEl(lbl,val,opts,fn){
  var w=document.createElement('div');
  w.appendChild(el('span','fontSize:10px;fontWeight:700;letterSpacing:2px;textTransform:uppercase;color:#94a3b8;display:block;marginBottom:4px',[lbl]));
  var s=document.createElement('select');
  s.style.cssText='border:none;borderBottom:1px solid #e2e8f0;background:transparent;color:#1e293b;padding:5px 0;outline:none;width:100%;fontSize:14px;cursor:pointer';
  s.onfocus=function(){s.style.borderBottomColor='#2ab7a9';};
  s.onblur=function(){s.style.borderBottomColor='#e2e8f0';};
  opts.forEach(function(o){var ov=o.v||o,ol=o.l||o;var op=document.createElement('option');op.value=ov;op.textContent=ol;if(ov===val)op.selected=true;s.appendChild(op);});
  s.onchange=function(){fn(s.value);};
  w.appendChild(s); return w;
}
function totRow(l,v){
  var d=document.createElement('div');
  d.style.cssText='display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:13px';
  d.appendChild(el('span','',[l]));
  d.appendChild(el('span','fontWeight:600',[v]));
  return d;
}
function totFin(v){
  var d=document.createElement('div');
  d.style.cssText='display:flex;justify-content:space-between;padding:9px 12px;margin-top:5px;border-radius:10px;border:2px solid #2ab7a9;font-size:14px';
  d.appendChild(el('span','fontWeight:700',['TOTAL']));
  d.appendChild(el('span','fontWeight:700;color:#0f766e',[v]));
  return d;
}
function overlay(){
  var d=document.createElement('div');
  d.style.cssText='position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;background:rgba(13,59,110,.7)';
  return d;
}
function dialog(){
  var d=document.createElement('div');
  d.style.cssText='background:white;border-radius:20px;padding:20px;width:100%;max-width:460px;max-height:92vh;overflow-y:auto;animation:fi .15s ease';
  return d;
}
function sheet(){
  var d=document.createElement('div');
  d.style.cssText='background:white;width:100%;max-width:560px;border-radius:20px 20px 0 0;display:flex;flex-direction:column;max-height:92vh;padding:16px;gap:0;animation:su .2s ease-out';
  return d;
}

/* ── Internet detection ── */
function isOnline(){ return navigator.onLine; }
window.addEventListener('online', function(){
  var btn=document.getElementById('_ai_btn');
  if(btn){btn.disabled=false;btn.style.opacity='1';btn.title='';}
  showNetBanner(true);
});
window.addEventListener('offline', function(){
  var btn=document.getElementById('_ai_btn');
  if(btn){btn.disabled=true;btn.style.opacity='.4';btn.title='Sin internet';}
  showNetBanner(false);
});
function showNetBanner(online){
  var old=document.getElementById('_netbanner');
  if(old)old.remove();
  var b=document.createElement('div');
  b.id='_netbanner';
  b.textContent=online?'✅ Conectado — IA disponible':'📡 Sin internet — solo modo local';
  b.style.cssText='position:fixed;bottom:72px;left:50%;transform:translateX(-50%);background:'+(online?'#0d3b6e':'#64748b')+';color:white;fontSize:12px;fontWeight:600;padding:6px 16px;borderRadius:999px;zIndex:100;boxShadow:0 2px 8px rgba(0,0,0,.2)';
  document.body.appendChild(b);
  setTimeout(function(){if(b.parentNode)b.remove();},3000);
}
loadS();
buildIdx();
renderApp();
})();
