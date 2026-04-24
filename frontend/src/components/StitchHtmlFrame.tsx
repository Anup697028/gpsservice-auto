import React from 'react';

type StitchHtmlFrameProps = {
  html: string;
  title: string;
};

export const StitchHtmlFrame: React.FC<StitchHtmlFrameProps> = ({ html, title }) => {
  return (
    <div className="h-screen w-full overflow-hidden bg-background-light">
      <iframe
        title={title}
        srcDoc={html}
        className="h-full w-full border-0"
      />
    </div>
  );
};
