'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

type Props={paused:boolean;pulse:number;onReady:()=>void};
export default function LoopScene({paused,pulse,onReady}:Props){
 const host=useRef<HTMLDivElement>(null);
 const pausedRef=useRef(paused);const pulseRef=useRef(pulse);const ready=useRef(onReady);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{pausedRef.current=paused;},[paused]);
 useEffect(()=>{pulseRef.current=pulse;},[pulse]);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{setFailed(true);ready.current();return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  element.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,.1,100);camera.position.set(.8,.35,12.7);camera.lookAt(.8,0,0);
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();
  const group=new THREE.Group();group.rotation.z=-.08;scene.add(group);
  const silver=new THREE.MeshPhysicalMaterial({color:0x8395b2,metalness:1,roughness:.19,clearcoat:1,clearcoatRoughness:.12,side:THREE.DoubleSide,envMapIntensity:1.8});
  const cobalt=new THREE.MeshPhysicalMaterial({color:0x074cec,metalness:.7,roughness:.23,clearcoat:1,side:THREE.DoubleSide,envMapIntensity:2});
  const lineMaterial=new THREE.MeshBasicMaterial({color:0x278bff,transparent:true,opacity:.85});
  const lightMaterial=new THREE.MeshBasicMaterial({color:0xb5e6ff});
  const haloMaterial=new THREE.MeshBasicMaterial({color:0x216dff,transparent:true,opacity:.16,depthWrite:false,blending:THREE.AdditiveBlending});
  const paths:THREE.CatmullRomCurve3[]=[];
  const particles:THREE.Mesh[]=[];
  const geometries:THREE.BufferGeometry[]=[];
  for(let lane=0;lane<3;lane++){
   const shift=(lane-1)*.16;
   const curve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.35,.2+shift,.5+shift),
    new THREE.Vector3(-.35,-1.46+shift,.35+shift),
    new THREE.Vector3(-1.75,-1.05+shift,.12+shift),
    new THREE.Vector3(-2.05,.48+shift,-.15+shift),
    new THREE.Vector3(-1.1,1.65+shift,-.2+shift),
    new THREE.Vector3(.35,1.3+shift,.3+shift),
    new THREE.Vector3(1.35,.2+shift,.5+shift),
    new THREE.Vector3(2.55,(lane-1)*.5,.1+shift),
    new THREE.Vector3(4.15,(lane-1)*1.48,-.2+shift),
   ],false,'centripetal');
   paths.push(curve);
   const positions:number[]=[],indices:number[]=[];const edges:THREE.Vector3[]=[];
   const segments=220,sides=12;
   for(let i=0;i<=segments;i++){
    const t=i/segments,p=curve.getPoint(t),tangent=curve.getTangent(t);
    const cross=new THREE.Vector3(-tangent.y,tangent.x,.8*Math.sin(t*Math.PI*3+lane*.3)).normalize();
    const depth=new THREE.Vector3().crossVectors(tangent,cross).normalize();
    const width=t<.68?.28:.28*(1-(t-.68)/.32)*.9+.018;
    const thickness=width*.24;
    edges.push(p.clone().addScaledVector(cross,width));
    for(let side=0;side<sides;side++){
     const angle=side/sides*Math.PI*2;
     const v=p.clone().addScaledVector(cross,Math.cos(angle)*width).addScaledVector(depth,Math.sin(angle)*thickness);
     positions.push(v.x,v.y,v.z);
     if(i<segments){const a=i*sides+side,b=i*sides+(side+1)%sides;indices.push(a,b,a+sides,b,b+sides,a+sides);}
    }
   }
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();geometries.push(geo);
   group.add(new THREE.Mesh(geo,lane===1?cobalt:silver));
   const edgeCurve=new THREE.CatmullRomCurve3(edges);const edgeGeo=new THREE.TubeGeometry(edgeCurve,220,.011,5,false);geometries.push(edgeGeo);group.add(new THREE.Mesh(edgeGeo,lineMaterial));
   const sphereGeo=new THREE.SphereGeometry(.046,12,12);geometries.push(sphereGeo);
   const terminal=new THREE.Mesh(sphereGeo,lightMaterial);terminal.position.copy(curve.getPoint(1));group.add(terminal);
   const haloGeo=new THREE.SphereGeometry(.14,12,12);geometries.push(haloGeo);const halo=new THREE.Mesh(haloGeo,haloMaterial);halo.position.copy(terminal.position);group.add(halo);
   for(let n=0;n<4;n++){const dot=new THREE.Mesh(sphereGeo,lightMaterial);dot.scale.setScalar(n===0?1.15:.5);group.add(dot);particles.push(dot);}
  }
  const key=new THREE.DirectionalLight(0xe0efff,4);key.position.set(-3,5,5);scene.add(key);
  const blue=new THREE.PointLight(0x146aff,45,15);blue.position.set(-1,-1,3);scene.add(blue);
  const fill=new THREE.DirectionalLight(0x4287ff,3);fill.position.set(3,-2,-1);scene.add(fill);
  const mouse=new THREE.Vector2();const target=new THREE.Vector2();let visible=true,frame=0,time=0,last=performance.now(),previousPulse=pulseRef.current,burst=0,needsRender=true,lastPaused=pausedRef.current;
  const move=(event:PointerEvent)=>{const rect=element.getBoundingClientRect();target.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height*2-1));};
  const leave=()=>target.set(0,0);
  element.addEventListener('pointermove',move);element.addEventListener('pointerleave',leave);
  const resize=()=>{needsRender=true;const {width,height}=element.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.position.z=camera.aspect<1.1?17:12.7;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});intersection.observe(element);
  const render=(stamp:number)=>{
   frame=requestAnimationFrame(render);const dt=Math.max(0,Math.min((stamp-last)/1000,.05));last=stamp;
   if(!visible||document.hidden)return;
   if(lastPaused!==pausedRef.current){needsRender=true;lastPaused=pausedRef.current;}
   if(pausedRef.current&&!needsRender)return;
   needsRender=false;
   if(pulseRef.current!==previousPulse){previousPulse=pulseRef.current;burst=1;}
   if(!pausedRef.current){time+=dt;burst=Math.max(0,burst-dt*.4);mouse.lerp(target,.035);group.rotation.y=mouse.x*.2;group.rotation.x=mouse.y*.12;group.position.y=Math.sin(time*.48)*.075;blue.position.x=-1+mouse.x*2;}
   else{mouse.set(0,0);group.rotation.x=0;group.rotation.y=0;group.position.y=0;burst=0;}
   particles.forEach((dot,index)=>{const lane=Math.floor(index/4),slot=index%4;const progress=(time*(.075+burst*.13)+slot*.25+lane*.08)%1;dot.position.copy(paths[lane].getPoint(progress));dot.visible=!pausedRef.current;dot.scale.setScalar(slot===0?1+burst: .45);});
   renderer.render(scene,camera);
  };
  render(performance.now());ready.current();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();element.removeEventListener('pointermove',move);element.removeEventListener('pointerleave',leave);geometries.forEach(g=>g.dispose());silver.dispose();cobalt.dispose();lineMaterial.dispose();lightMaterial.dispose();haloMaterial.dispose();environment.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <div className="loop-canvas" ref={host} data-renderer={failed?'fallback':'webgl'}>{failed&&<img className="scene-fallback" src="/brand/mezoloop-logo.png" alt="Silver MezoLoop symbol with three blue payment streams"/>}</div>;
}
