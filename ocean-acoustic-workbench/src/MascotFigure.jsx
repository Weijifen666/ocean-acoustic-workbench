import React, { useId } from "react";

/** Hand-authored original ocean explorer; no official mascot/brand assets. */
export default function MascotFigure({
  busy = false,
  wave = false,
  className = "",
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`mascot-figure${busy ? " is-thinking" : ""}${wave ? " is-waving" : ""} ${className}`}
      viewBox="0 0 180 214"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-suit`}
          x1="55"
          y1="111"
          x2="122"
          y2="189"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DCEBF3" />
        </linearGradient>
        <linearGradient
          id={`${id}-helmet`}
          x1="52"
          y1="28"
          x2="125"
          y2="111"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DDEEF5" />
        </linearGradient>
        <linearGradient
          id={`${id}-visor`}
          x1="58"
          y1="45"
          x2="119"
          y2="104"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E0F4F7" />
          <stop offset="1" stopColor="#9DC4D5" />
        </linearGradient>
      </defs>
      <ellipse
        className="mascot-shadow"
        cx="91"
        cy="204"
        rx="38"
        ry="5"
        fill="#214E70"
        opacity=".12"
      />
      <g className="mascot-body">
        <g className="mascot-bubbles" stroke="#87BDC9">
          <circle cx="26" cy="75" r="3" />
          <circle cx="146" cy="40" r="4" />
          <circle cx="154" cy="95" r="2" />
        </g>
        <path
          d="M58 125C43 124 36 143 41 158L53 165 65 142"
          fill="#C3DCE8"
          stroke="#3B708E"
          strokeWidth="2"
        />
        <path
          d="M117 121H129V159H116"
          fill="#B6D2E2"
          stroke="#3B708E"
          strokeWidth="2"
        />
        <path
          d="M126 131H134V147H126"
          fill="#E2F0F5"
          stroke="#3B708E"
          strokeWidth="2"
        />
        <path
          d="M64 116C50 122 50 144 55 164L65 182H114L124 164C128 144 127 125 113 116H64Z"
          fill={`url(#${id}-suit)`}
          stroke="#3B708E"
          strokeWidth="2.3"
        />
        <path
          d="M67 175L64 197H84L89 176M95 176L97 197H117L112 175"
          fill="#EFF7FA"
          stroke="#3B708E"
          strokeWidth="2"
        />
        <path d="M64 189H84V202H58C55 199 58 191 64 189Z" fill="#285D7E" />
        <path d="M98 189H116C123 190 128 197 125 202H97V189Z" fill="#285D7E" />
        <path d="M64 198H83M100 198H122" stroke="#A7C8DB" strokeWidth="2" />
        <g className="mascot-arm-left">
          <path
            d="M59 122C47 123 39 138 35 149L39 159 48 154 61 135"
            fill={`url(#${id}-suit)`}
            stroke="#3B708E"
            strokeWidth="2"
          />
          <path
            d="M35 150C28 151 27 158 31 163C35 168 42 164 44 159L39 151"
            fill="#FFFFFF"
            stroke="#3B708E"
            strokeWidth="2"
          />
          <path d="M36 147L45 152" stroke="#387EA5" strokeWidth="5" />
        </g>
        <g className="mascot-arm-wave">
          <path
            d="M118 121C130 117 137 106 139 93L131 88 124 103 112 113"
            fill={`url(#${id}-suit)`}
            stroke="#3B708E"
            strokeWidth="2"
          />
          <path
            d="M132 94C128 89 126 84 126 79C125 75 128 74 130 76L133 81 131 69C130 65 133 63 135 66L138 77 139 64C139 60 143 60 144 64L145 77 149 68C151 64 154 67 152 72L149 85C148 91 143 95 139 96Z"
            fill="#FFFFFF"
            stroke="#3B708E"
            strokeWidth="1.9"
          />
          <path d="M130 94L139 98" stroke="#387EA5" strokeWidth="5" />
        </g>
        <path d="M58 114H118L111 125H66L58 114Z" fill="#2D6588" />
        <path
          d="M68 137H109V164H68V137Z"
          fill="#E0F1F6"
          stroke="#A7C8DA"
          strokeWidth="1.3"
        />
        <path
          d="M72 147Q78 140 84 147T96 147T108 147M73 154Q79 147 85 154T97 154T108 154"
          stroke="#3B8E9C"
          strokeWidth="2"
        />
        <circle
          className="mascot-suit-light"
          cx="60"
          cy="142"
          r="2.4"
          fill="#CBA76C"
        />
        <path d="M88 165V178M57 170H122" stroke="#A9C9DB" strokeWidth="1.5" />
        <path
          d="M40 73C40 45 61 22 88 22H93C121 22 141 44 141 73C141 99 123 118 91 118C59 118 40 99 40 73Z"
          fill={`url(#${id}-helmet)`}
          stroke="#3B708E"
          strokeWidth="2.6"
        />
        <path
          d="M49 74C49 52 63 39 89 39H94C119 39 132 52 132 74C132 95 116 105 91 105C66 105 49 95 49 74Z"
          fill={`url(#${id}-visor)`}
          stroke="#6D9DB5"
          strokeWidth="1.7"
        />
        <path
          d="M60 68C60 52 70 45 91 45C113 45 123 54 122 71L120 82C118 98 107 105 91 105C74 105 63 96 61 82L60 68Z"
          fill="#F7D5B5"
        />
        <path
          d="M59 65C58 48 69 39 91 41C110 35 125 48 124 69L118 62 113 50C102 62 86 57 83 52C78 60 70 60 64 59L59 65Z"
          fill="#3B4A5B"
        />
        <path
          d="M65 48C72 44 77 43 86 46"
          stroke="#637080"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <g className="mascot-glasses" stroke="#254D70" strokeWidth="3.1">
          <rect x="64" y="66" width="24" height="18" rx="7" fill="#ECF7F799" />
          <rect x="95" y="66" width="24" height="18" rx="7" fill="#ECF7F799" />
          <path d="M88 71H95M60 71H64M119 71H123" />
        </g>
        <g className="mascot-eyes" fill="#28455C">
          <ellipse cx="77" cy="76" rx="2.8" ry="3.5" />
          <ellipse cx="107" cy="76" rx="2.8" ry="3.5" />
        </g>
        <path
          d="M89 81Q91 84 94 81"
          stroke="#DBA989"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M83 92Q91 99 100 91"
          stroke="#9E6454"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <ellipse cx="70" cy="87" rx="5" ry="2.7" fill="#EFAFA0" opacity=".45" />
        <ellipse
          cx="112"
          cy="87"
          rx="5"
          ry="2.7"
          fill="#EFAFA0"
          opacity=".45"
        />
        <path
          d="M50 67C52 56 58 48 68 43"
          stroke="#FFFFFF"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".75"
        />
        <path
          d="M48 75H42V91H49M132 75H140V90H133"
          fill="#D5E8F2"
          stroke="#3B708E"
          strokeWidth="1.6"
        />
        <path
          d="M43 89C39 102 47 109 61 108"
          stroke="#3B8E9C"
          strokeWidth="3"
        />
        <rect x="58" y="104" width="8" height="6" rx="3" fill="#265F7E" />
        <path
          d="M68 29Q90 21 113 29"
          stroke="#C2DCE8"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
