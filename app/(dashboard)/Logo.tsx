import React from 'react';

export default function Logo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 100 100" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6D28D9" />
          <stop offset="100%" stopColor="#C9A96E" />
        </linearGradient>
      </defs>
      <g className="animate-slow-spin origin-center">
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(0 50 50)" />
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(60 50 50)" />
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(120 50 50)" />
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(180 50 50)" />
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(240 50 50)" />
        <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="url(#logo-gradient)" strokeWidth="2.5" transform="rotate(300 50 50)" />
      </g>
      <g transform="translate(50, 52)">
        <circle cx="0" cy="-10" r="7" fill="url(#logo-gradient)" />
        <path d="M -14 10 C -14 0, 14 0, 14 10 L 14 15 L -14 15 Z" fill="url(#logo-gradient)" />
      </g>
    </svg>
  );
}
