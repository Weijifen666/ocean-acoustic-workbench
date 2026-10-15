import React, { useEffect, useRef, useState } from "react";
import SakanaWidget from "sakana-widget/core";
import guideImage from "./assets/ocean-assistant-v07.png";

// Actual MIT-licensed Sakana Widget 4.0.0 core; no bundled anime character entries.
SakanaWidget.registerCharacter("ocean-researcher", {
  image: guideImage,
  initialState: { i: 0.04, s: 0.12, d: 0.92, r: 0, y: 0, t: 0, w: 0 },
});

export default function SakanaGuide({
  busy = false,
  wave = false,
  className = "",
}) {
  const host = useRef(null),
    widget = useRef(null);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = () => setCompact(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (reduced || compact || !host.current) return;
    const instance = new SakanaWidget({
      character: "ocean-researcher",
      size: 142,
      imageFit: "contain",
      controls: false,
      rod: false,
      draggable: false,
      title: false,
      threshold: 0.16,
    }).mount(host.current);
    widget.current = instance;
    return () => {
      widget.current = null;
      instance.unmount();
    };
  }, [reduced, compact]);
  useEffect(() => {
    if (!reduced)
      widget.current?.setState({
        w: wave ? 1.9 : busy ? 0.65 : 0.15,
        t: wave ? -0.5 : 0,
        r: wave ? -3 : 0,
      });
  }, [busy, wave, reduced]);
  return (
    <div
      className={`mascot-figure sakana-course-figure${className ? " " + className : ""}${busy ? " is-thinking" : ""}${compact ? " is-mobile-portrait" : ""}`}
      aria-hidden="true"
      onMouseEnter={() => {
        if (!reduced) widget.current?.setState({ w: 1.4, r: -2 });
      }}
    >
      {reduced || compact ? (
        <img src={guideImage} alt="" />
      ) : (
        <div ref={host} className="sakana-course-mount" />
      )}
    </div>
  );
}

export function OceanProfile() {
  return (
    <div className="ocean-profile card-base">
      <svg viewBox="0 0 240 154" fill="none" aria-hidden="true">
        <circle cx="190" cy="28" r="35" fill="#FFF6DF" />
        <path
          d="M0 60C40 39 65 74 107 58S174 37 240 60V154H0Z"
          fill="#C5EAF1"
        />
        <path
          d="M0 80C49 59 81 97 121 78S190 64 240 76V154H0Z"
          fill="#9BD6E6"
        />
        <path
          d="M0 104C53 81 81 124 131 105S194 95 240 105V154H0Z"
          fill="#79BBD4"
        />
        <path d="M11 49L71 30 59 46 40 46 29 52Z" fill="#fff" opacity=".8" />
        <path
          d="M18 126C57 115 88 138 130 126M8 139C47 128 83 151 125 140"
          stroke="#E8FAFC"
          strokeWidth="2"
        />
      </svg>
      <img src={guideImage} alt="原创海洋研究员" />
      <div>
        <span>NPU · 西北工业大学</span>
        <strong>向海而行</strong>
        <small>公诚勇毅 · 课程研究空间</small>
      </div>
    </div>
  );
}

export { guideImage };
