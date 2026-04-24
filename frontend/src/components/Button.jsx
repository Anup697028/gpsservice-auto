import React from 'react';
import '../styles/button.css';

export const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  disabled = false,
  className = '',
  ...props 
}) => {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${variant} ${disabled ? 'btn-disabled' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
