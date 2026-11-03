import React, {useState} from 'react';
import './resource-image.css';

function ImageRequest({src, alt, onError, ...props}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="resource-image-unavailable" role="status">图片暂不可用，请确认资料与计算节点连接。</span>;
  return <img {...props} src={src} alt={alt} onError={event => {setFailed(true);onError?.(event);}}/>;
}

// A URL change creates a fresh image request. Node status is deliberately not
// consulted: a cached or otherwise reachable source page must remain visible.
export default function ResourceImage(props) {
  return <ImageRequest key={props.src || 'missing'} {...props}/>;
}
