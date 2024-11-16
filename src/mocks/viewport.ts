import mediaQuery from 'css-mq-parser';
import { mockMediaQueryListEvent } from './MediaQueryListEvent';
import { getConfig } from '../tools';
import { isJsdomEnv, WrongEnvironmentError } from '../helper';

const config = getConfig();

/**
 *  A tool that allows testing components that use js media queries (matchMedia)
 * `mockViewport` must be called before rendering the component
 *  @example using react testing library
 *
 *  const viewport = mockViewport({ width: '320px', height: '568px' })
 *
 *  const { getByText, queryByText } = render(<TestComponent />)
 *
 *  expect(getByText('Content visible only in the phone')).toBeInTheDocument()
 *  expect(queryByText('Content visible only on desktop')).not.toBeInTheDocument()
 *
 *  act(() => {
 *    viewport.set({ width: '1440px', height: '900px' })
 *  })
 *
 *  expect(queryByText('Content visible only on the phone')).not.toBeInTheDocument()
 *  expect(getByText('Content visible only on desktop')).toBeInTheDocument()
 *
 *  viewport.cleanup()
 *
 */

export type MediaValues = Record<
    | "orientation"
    | "scan"
    | "width"
    | "height"
    | "device-width"
    | "device-height"
    | "resolution"
    | "aspect-ratio"
    | "device-aspect-ratio"
    | "grid"
    | "color"
    | "color-index"
    | "monochrome"
    | "prefers-color-scheme",
    unknown
>;

export type ViewportDescription = Partial<MediaValues>;
export type MockViewport = {
  cleanup: () => void;
  set: (newDesc: ViewportDescription) => void;
};

type Listener = (this: MediaQueryList, ev: MediaQueryListEvent) => void;
type ListenerObject = {
  handleEvent: (ev: MediaQueryListEvent) => void;
};
type ListenerOrListenerObject = Listener | ListenerObject;

function isEventListenerObject(
  obj: ListenerOrListenerObject
): obj is ListenerObject {
  return (obj as ListenerObject).handleEvent !== undefined;
}

function mockViewport(desc: ViewportDescription): MockViewport {
  if (!isJsdomEnv()) {
    throw new WrongEnvironmentError();
  }

  mockMediaQueryListEvent();

  const state: {
    currentDesc: ViewportDescription;
    oldListeners: {
      listener: Listener;
      list: MediaQueryList;
      matches: boolean;
    }[];
    listeners: {
      listener: ListenerOrListenerObject;
      list: MediaQueryList;
      matches: boolean;
    }[];
  } = {
    currentDesc: desc,
    oldListeners: [],
    listeners: [],
  };

  const savedImplementation = window.matchMedia;

  const addOldListener = (
    list: MediaQueryList,
    matches: boolean,
    listener: Listener
  ) => {
    state.oldListeners.push({ listener, matches, list });
  };

  const removeOldListener = (listenerToRemove: Listener) => {
    const index = state.oldListeners.findIndex(
      ({ listener }) => listener === listenerToRemove
    );

    state.oldListeners.splice(index, 1);
  };

  const addListener = (
    list: MediaQueryList,
    matches: boolean,
    listener: ListenerOrListenerObject
  ) => {
    state.listeners.push({ listener, matches, list });
  };

  const removeListener = (listenerToRemove: ListenerOrListenerObject) => {
    const index = state.listeners.findIndex(
      ({ listener }) => listener === listenerToRemove
    );

    state.listeners.splice(index, 1);
  };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      get matches() {
        return mediaQuery.match(query, state.currentDesc);
      },
      media: query,
      onchange: null,
      addListener: function (listener) {
        if (listener) {
          addOldListener(this, this.matches, listener);
        }
      }, // deprecated
      removeListener: (listener) => {
        if (listener) {
          removeOldListener(listener);
        }
      }, // deprecated
      addEventListener: function (
        eventType: Parameters<MediaQueryList['addEventListener']>[0],
        listener: Parameters<MediaQueryList['addEventListener']>[1]
      ) {
        if (eventType === 'change') {
          addListener(this, this.matches, listener);
        }
      },
      removeEventListener: (
        eventType: Parameters<MediaQueryList['removeEventListener']>[0],
        listener: Parameters<MediaQueryList['removeEventListener']>[1]
      ) => {
        if (eventType === 'change') {
          if (isEventListenerObject(listener)) {
            removeListener(listener.handleEvent);
          } else {
            removeListener(listener);
          }
        }
      },
      dispatchEvent: (event: Event) => {
        if (event.type === 'change') {
          state.listeners.forEach(({ listener, list }) => {
            if (isEventListenerObject(listener)) {
              listener.handleEvent(event as MediaQueryListEvent);
            } else {
              listener.call(list, event as MediaQueryListEvent);
            }
          });

          state.oldListeners.forEach(({ listener, list }) => {
            listener.call(list, event as MediaQueryListEvent);
          });
        }

        return true;
      },
    }),
  });

  return {
    cleanup: () => {
      window.matchMedia = savedImplementation;
    },
    set: (newDesc: ViewportDescription) => {
      config.act(() => {
        state.currentDesc = newDesc;
        state.listeners.forEach(
          ({ listener, matches, list }, listenerIndex) => {
            const newMatches = list.matches;

            if (newMatches !== matches) {
              const changeEvent = new MediaQueryListEvent('change', {
                matches: newMatches,
                media: list.media,
              });

              if (isEventListenerObject(listener)) {
                listener.handleEvent(changeEvent);
              } else {
                listener.call(list, changeEvent);
              }

              state.listeners[listenerIndex].matches = newMatches;
            }
          }
        );

        state.oldListeners.forEach(
          ({ listener, matches, list }, listenerIndex) => {
            const newMatches = list.matches;

            if (newMatches !== matches) {
              const changeEvent = new MediaQueryListEvent('change', {
                matches: newMatches,
                media: list.media,
              });

              listener.call(list, changeEvent);

              state.oldListeners[listenerIndex].matches = newMatches;
            }
          }
        );
      });
    },
  };
}

function mockViewportForTestGroup(desc: ViewportDescription) {
  let viewport: MockViewport;

  config.beforeAll(() => {
    viewport = mockViewport(desc);
  });

  config.afterAll(() => {
    viewport.cleanup();
  });
}

export { mockViewport, mockViewportForTestGroup };
