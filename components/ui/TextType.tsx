'use client';

import React, { useEffect, useState } from 'react';

export interface TextTypeProps {
  text: string[] | string;
  typingSpeed?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
  deleteMode?: 'backspace' | 'clear';
  typeEffect?: 'none' | 'fade' | 'slide';
  mistakes?: number;
  cursorStyle?: 'underscore' | 'pipe' | 'block';
  cursorGlide?: boolean;
  showCursor?: boolean;
  cursorColor?: string;
  prefixColor?: string;
  cursorBlinkDuration?: number;
  cursorCharacter?: string;
  prefix?: string;
  className?: string;
}

export const TextType: React.FC<TextTypeProps> = ({
  text,
  typingSpeed = 75,
  pauseDuration = 1500,
  deletingSpeed = 50,
  deleteMode = 'backspace',
  showCursor = true,
  cursorColor = 'currentColor',
  prefixColor = 'currentColor',
  cursorBlinkDuration = 0.5,
  cursorCharacter = '_',
  prefix = '',
  className = ''
}) => {
  const strings = Array.isArray(text) ? text : [text];
  const [strIndex, setStrIndex] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fullText = strings[strIndex % strings.length];

    if (!isDeleting && currentText === fullText) {
      const pauseTimeout = setTimeout(() => {
        setIsDeleting(true);
      }, pauseDuration);
      return () => clearTimeout(pauseTimeout);
    }

    if (isDeleting && currentText === '') {
      setIsDeleting(false);
      setStrIndex((prev) => (prev + 1) % strings.length);
      return;
    }

    const speed = isDeleting ? deletingSpeed : typingSpeed;
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        setCurrentText(fullText.slice(0, currentText.length + 1));
      } else {
        if (deleteMode === 'clear') {
          setCurrentText('');
        } else {
          setCurrentText(fullText.slice(0, currentText.length - 1));
        }
      }
    }, speed);

    return () => clearTimeout(timeout);
  }, [currentText, isDeleting, strIndex, strings, typingSpeed, deletingSpeed, pauseDuration, deleteMode]);

  return (
    <span className={`inline-flex items-baseline ${className}`}>
      {prefix && (
        <span style={{ color: prefixColor }} className="mr-1">
          {prefix}
        </span>
      )}
      <span>{currentText}</span>
      {showCursor && (
        <span
          className="ml-0.5 inline-block"
          style={{
            color: cursorColor,
            animation: `textTypeBlink ${cursorBlinkDuration}s infinite alternate`
          }}
        >
          {cursorCharacter}
        </span>
      )}
    </span>
  );
};

export default TextType;
