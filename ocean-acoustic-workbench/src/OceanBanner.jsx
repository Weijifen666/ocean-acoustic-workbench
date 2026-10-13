import React from "react";

/** Original course artwork. This is not the university seal or an official platform. */
export default function OceanBanner() {
  return (
    <section className="ocean-banner" aria-label="西北工业大学海洋声学课程项目">
      <div className="ocean-banner-copy">
        <div className="ocean-school-line">
          <span className="ocean-npu-mark">NPU</span>
          <span>
            西北工业大学<span className="ocean-school-divider">/</span>
            四人小组课程项目
          </span>
        </div>
        <h2>以声探海，以学致用</h2>
        <div className="ocean-banner-caption">
          <span>公诚勇毅</span>
          <i />
          <span>航空 · 航天 · 航海</span>
          <small>仅用于课程作业</small>
        </div>
      </div>
      <svg
        className="ocean-banner-art"
        viewBox="0 0 460 110"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M1 48C42 28 67 70 108 48S174 28 216 48 281 69 322 48 392 25 460 48"
          stroke="#89B8C7"
          strokeWidth="1.5"
        />
        <path
          d="M1 65C46 47 76 79 114 65S178 45 221 65 280 84 325 65 401 44 460 65"
          stroke="#B7D4DD"
        />
        <path
          d="M1 84C39 62 89 106 131 84S203 60 240 84 304 101 350 82 409 70 460 87"
          stroke="#D1E2E8"
        />
        <path
          d="M1 103C51 82 81 119 129 103S195 83 246 103 307 117 359 100 420 84 460 103"
          stroke="#E1EDF0"
        />
        <path d="M90 34H150L140 45H102L90 34Z" fill="#234E71" />
        <path
          d="M109 21H129V34H109V21Z"
          fill="#F1F6F8"
          stroke="#234E71"
          strokeWidth="1.4"
        />
        <path
          d="M116 21V14M125 21V17M130 29H139V34"
          stroke="#234E71"
          strokeWidth="1.4"
        />
        <path d="M113 25H120M123 25H128" stroke="#72A0B8" strokeWidth="2" />
        <path d="M160 18L201 12 177 24 171 24 160 18Z" fill="#3C789E" />
        <path
          d="M177 16L174 7 180 6 185 15M175 21L169 30 172 30 185 20"
          fill="#3C789E"
        />
        <g transform="translate(310 12) rotate(15)">
          <path
            d="M0 17C0 5 5 0 5 0S10 5 10 17V28H0V17Z"
            fill="#FBFDFF"
            stroke="#427794"
            strokeWidth="1.4"
          />
          <path d="M0 22L-5 29V31L0 28M10 22L15 29V31L10 28" fill="#427794" />
          <circle cx="5" cy="12" r="2.1" fill="#92BBCB" />
          <path d="M3 31L5 38 7 31" stroke="#C7A064" strokeWidth="1.5" />
        </g>
        <g transform="translate(250 71)">
          <path
            d="M0 10C0 4 9 0 30 0H55C69 0 77 6 77 10S69 20 55 20H30C9 20 0 16 0 10Z"
            fill="#7BA8BB"
          />
          <path d="M32 0V-7H47V0" fill="#426F88" />
          <circle cx="27" cy="10" r="3.2" fill="#F8FCFD" />
          <circle cx="40" cy="10" r="3.2" fill="#F8FCFD" />
          <circle cx="53" cy="10" r="3.2" fill="#F8FCFD" />
          <path
            d="M73 10H83M77 5L83 10 77 15"
            stroke="#426F88"
            strokeWidth="1.6"
          />
        </g>
        <path
          d="M117 48C125 63 153 80 196 88M126 48C148 59 186 62 226 82"
          stroke="#4C8F9B"
          strokeDasharray="3 5"
          opacity=".65"
        />
        <circle cx="196" cy="88" r="2.4" fill="#6DA0B0" />
        <circle cx="226" cy="82" r="2.4" fill="#6DA0B0" />
        <path
          d="M440 12V96M436 28H440M436 49H440M436 70H440M436 91H440"
          stroke="#B4CBD7"
        />
      </svg>
    </section>
  );
}
