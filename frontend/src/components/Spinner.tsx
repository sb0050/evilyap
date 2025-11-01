import React from 'react';

type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'white' | 'gray' | 'indigo';
  variant?: 'all' | 'top' | 'bottom';
  className?: string;
};

const sizeClass = (size: SpinnerProps['size']) => {
  switch (size) {
    case 'sm':
      return 'h-4 w-4';
    case 'lg':
      return 'h-12 w-12';
    case 'md':
    default:
      return 'h-8 w-8';
  }
};

const colorClass = (color: SpinnerProps['color']) => {
  switch (color) {
    case 'white':
      return 'border-white';
    case 'gray':
      return 'border-gray-300';
    case 'indigo':
      return 'border-indigo-600';
    case 'blue':
    default:
      return 'border-blue-600';
  }
};

const variantClass = (variant: SpinnerProps['variant']) => {
  switch (variant) {
    case 'top':
      return 'border-t-2';
    case 'all':
      return 'border-2';
    case 'bottom':
    default:
      return 'border-b-2';
  }
};

export default function Spinner({
  size = 'md',
  color = 'blue',
  variant = 'bottom',
  className = '',
}: SpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full ${sizeClass(size)} ${variantClass(variant)} ${colorClass(color)} ${className}`}
    />
  );
}
