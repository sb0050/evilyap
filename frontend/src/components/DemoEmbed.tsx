export function DemoEmbed() {
  return (
    <div>
      <script async src='https://js.storylane.io/js/v2/storylane.js'></script>
      <div
        className='sl-embed sm:hidden'
        style={{
          position: 'relative',
          paddingBottom: 'calc(217.21% + 25px)',
          width: '100%',
          height: 0,
          transform: 'scale(1)',
        }}
      >
        <iframe
          loading='lazy'
          className='sl-demo'
          src='https://app.storylane.io/demo/arwuuwthb6nk?embed=popup'
          name='sl-embed'
          allow='fullscreen'
          allowFullScreen
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: '1px solid rgba(63,95,172,0.35)',
            boxShadow: '0px 0px 18px rgba(26, 19, 72, 0.15)',
            borderRadius: '10px',
            boxSizing: 'border-box',
          }}
        ></iframe>
      </div>
      <div
        className='sl-embed hidden sm:block'
        style={{
          position: 'relative',
          paddingBottom: 'calc(53.81% + 25px)',
          width: '100%',
          height: 0,
          transform: 'scale(1)',
        }}
      >
        <iframe
          loading='lazy'
          className='sl-demo'
          src='https://app.storylane.io/demo/imptycbxswra?embed=popup'
          name='sl-embed'
          allow='fullscreen'
          allowFullScreen
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: '1px solid rgba(63,95,172,0.35)',
            boxShadow: '0px 0px 18px rgba(26, 19, 72, 0.15)',
            borderRadius: '10px',
            boxSizing: 'border-box',
          }}
        ></iframe>
      </div>
    </div>
  );
}
