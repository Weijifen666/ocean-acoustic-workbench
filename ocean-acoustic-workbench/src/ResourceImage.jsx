import React, {useState} from 'react';
import './resource-image.css';

function ImageRequest({src, alt, onError, onLoad, onAvailabilityChange, ...props}) {
  const [failed, setFailed] = useState(false);
  const sourcePage=/^\/api\/source\/S\d{2,4}\/page\/\d+$/.test(src||'');
  if (!src || failed) return <span className="resource-image-unavailable" role="status">{sourcePage?'教材原页暂不可用：未提供原件或资料节点暂不可达。原理示意与补充教材页可继续查看。':'图片暂不可用，请稍后重试。'}</span>;
  return <img {...props} src={src} alt={alt} onLoad={event=>{onAvailabilityChange?.(true);onLoad?.(event);}} onError={event => {setFailed(true);onAvailabilityChange?.(false);onError?.(event);}}/>;
}

// A URL change creates a fresh image request. Node status is deliberately not
// consulted: a cached or otherwise reachable source page must remain visible.
export default function ResourceImage(props) {
  return <ImageRequest key={props.src || 'missing'} {...props}/>;
}

function LoadedImageButton({image,caption=image.caption,className,onOpen,onUnavailable,loading}) {
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  return <button type="button" className={className} disabled={!ready} aria-label={caption} title={failed?'此图片暂不可用':ready?'放大查看':'图片加载中'} onClick={()=>{if(ready)onOpen?.({...image,caption});}}>
    <ResourceImage loading={loading} src={image.url} alt={caption} onAvailabilityChange={available=>{setReady(available);setFailed(!available);if(!available)onUnavailable?.(image.url);}}/>
    <span>{caption}{ready&&<span aria-hidden="true"> ↗</span>}</span>
  </button>;
}

// A failed image can never open an empty lightbox. Its URL remains in the
// gallery's collapsed unavailable list, rather than being silently removed.
export function KnowledgeImageButton(props){return <LoadedImageButton key={props.image.url} {...props}/>;}

export function partitionKnowledgeImages(images,unavailable={}) {
  return {visible:images.filter(im=>!unavailable[im.url]&&im.availability!=='unavailable'),missing:images.filter(im=>unavailable[im.url]||im.availability==='unavailable')};
}

export function KnowledgeImageGallery({images=[],onOpen}) {
  const [unavailable,setUnavailable]=useState({});
  const {visible,missing}=partitionKnowledgeImages(images,unavailable);
  return <>
    <p className="drawer-help">原理示意由本项目绘制；教材原页与补充教材页保留各自标注，加载后可点击放大。</p>
    {visible.map(im=><KnowledgeImageButton key={im.url} image={im} className="knowledge-source-image" loading="lazy" onOpen={onOpen} onUnavailable={url=>setUnavailable(old=>({...old,[url]:true}))}/>)}
    {!!missing.length&&<details className="drawer-help"><summary>{missing.length} 张图片暂不可用</summary><p>教材原件未随项目分发，原页需资料节点提供。原始来源仍保留；示意图和补充教材页不冒充缺失的原课件。</p><ul>{missing.map(im=><li key={im.url}>{im.caption}</li>)}</ul><button type="button" onClick={()=>setUnavailable({})}>重试图片</button></details>}
  </>;
}
