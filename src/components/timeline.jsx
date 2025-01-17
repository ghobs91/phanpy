import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView } from 'react-intersection-observer';
import { useDebouncedCallback } from 'use-debounce';
import { useSnapshot } from 'valtio';

import states, { statusKey } from '../utils/states';
import statusPeek from '../utils/status-peek';
import { groupBoosts, groupContext, applyMutedWords } from '../utils/timeline-utils';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';
import useScroll from '../utils/useScroll';

import Icon from './icon';
import Link from './link';
import NavMenu from './nav-menu';
import Status from './status';
import AsyncText from './AsyncText';

const scrollIntoViewOptions = {
  block: 'nearest',
  inline: 'center',
  behavior: 'smooth',
};

function Timeline({
  title,
  titleComponent,
  id,
  instance,
  emptyText,
  errorText,
  useItemID, // use statusID instead of status object, assuming it's already in states
  boostsCarousel,
  fetchItems = () => {},
  checkForUpdates = () => {},
  checkForUpdatesInterval = 60_000, // 1 minute
  headerStart,
  headerEnd,
  timelineStart,
  allowFilters,
  refresh,
}) {
  const snapStates = useSnapshot(states);
  const [items, setItems] = useState([]);
  const [uiState, setUIState] = useState('default');
  const [showMore, setShowMore] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [visible, setVisible] = useState(true);
  const scrollableRef = useRef();

  console.debug('RENDER Timeline', id, refresh);

  const loadItems = useDebouncedCallback(
    (firstLoad) => {
      setShowNew(false);
      if (uiState === 'loading') return;
      setUIState('loading');
      (async () => {
        try {
          let { done, value } = await fetchItems(firstLoad);
          if (Array.isArray(value)) {
            if (boostsCarousel) {
              value = groupBoosts(value);
            }
            value = groupContext(value);
            // if (value) {
            //   value = applyMutedWords(value);
            // }
            if (firstLoad) {
              setItems(value);
            } else {
              setItems((items) => [...items, ...value]);
            }
            if (!value?.length) done = true;
            setShowMore(!done);
          } else {
            setShowMore(false);
          }
          setUIState('default');
        } catch (e) {
          console.error(e);
          setUIState('error');
        } 
        finally {
          loadItems.cancel();
        }
      })();
    },
    1500,
    {
      leading: true,
      trailing: false,
    },
  );

  const itemsSelector = '.timeline-item, .timeline-item-alt';

  const jRef = useHotkeys('j, shift+j', (_, handler) => {
    // focus on next status after active item
    const activeItem = document.activeElement.closest(itemsSelector);
    const activeItemRect = activeItem?.getBoundingClientRect();
    const allItems = Array.from(
      scrollableRef.current.querySelectorAll(itemsSelector),
    );
    if (
      activeItem &&
      activeItemRect.top < scrollableRef.current.clientHeight &&
      activeItemRect.bottom > 0
    ) {
      const activeItemIndex = allItems.indexOf(activeItem);
      let nextItem = allItems[activeItemIndex + 1];
      if (handler.shift) {
        // get next status that's not .timeline-item-alt
        nextItem = allItems.find(
          (item, index) =>
            index > activeItemIndex &&
            !item.classList.contains('timeline-item-alt'),
        );
      }
      if (nextItem) {
        nextItem.focus();
        nextItem.scrollIntoView(scrollIntoViewOptions);
      }
    } else {
      // If active status is not in viewport, get the topmost status-link in viewport
      const topmostItem = allItems.find((item) => {
        const itemRect = item.getBoundingClientRect();
        return itemRect.top >= 44 && itemRect.left >= 0; // 44 is the magic number for header height, not real
      });
      if (topmostItem) {
        topmostItem.focus();
        topmostItem.scrollIntoView(scrollIntoViewOptions);
      }
    }
  });

  const kRef = useHotkeys('k, shift+k', (_, handler) => {
    // focus on previous status after active item
    const activeItem = document.activeElement.closest(itemsSelector);
    const activeItemRect = activeItem?.getBoundingClientRect();
    const allItems = Array.from(
      scrollableRef.current.querySelectorAll(itemsSelector),
    );
    if (
      activeItem &&
      activeItemRect.top < scrollableRef.current.clientHeight &&
      activeItemRect.bottom > 0
    ) {
      const activeItemIndex = allItems.indexOf(activeItem);
      let prevItem = allItems[activeItemIndex - 1];
      if (handler.shift) {
        // get prev status that's not .timeline-item-alt
        prevItem = allItems.findLast(
          (item, index) =>
            index < activeItemIndex &&
            !item.classList.contains('timeline-item-alt'),
        );
      }
      if (prevItem) {
        prevItem.focus();
        prevItem.scrollIntoView(scrollIntoViewOptions);
      }
    } else {
      // If active status is not in viewport, get the topmost status-link in viewport
      const topmostItem = allItems.find((item) => {
        const itemRect = item.getBoundingClientRect();
        return itemRect.top >= 44 && itemRect.left >= 0; // 44 is the magic number for header height, not real
      });
      if (topmostItem) {
        topmostItem.focus();
        topmostItem.scrollIntoView(scrollIntoViewOptions);
      }
    }
  });

  const oRef = useHotkeys(['enter', 'o'], () => {
    // open active status
    const activeItem = document.activeElement.closest(itemsSelector);
    if (activeItem) {
      activeItem.click();
    }
  });

  const {
    scrollDirection,
    nearReachStart,
    nearReachEnd,
    reachStart,
    reachEnd,
  } = useScroll({
    scrollableRef,
    distanceFromEnd: 2,
    scrollThresholdStart: 44,
  });

  useEffect(() => {
    scrollableRef.current?.scrollTo({ top: 0 });
    loadItems(true);
  }, []);
  useEffect(() => {
    loadItems(true);
  }, [refresh]);

  useEffect(() => {
    if (reachStart) {
      loadItems(true);
    }
  }, [reachStart]);

  useEffect(() => {
    if (nearReachEnd || (reachEnd && showMore)) {
      loadItems();
    }
  }, [nearReachEnd, showMore]);

  const loadOrCheckUpdates = useCallback(
    async ({ disableIdleCheck = false } = {}) => {
      console.log('✨ Load or check updates', {
        autoRefresh: snapStates.settings.autoRefresh,
        scrollTop: scrollableRef.current.scrollTop,
        disableIdleCheck,
        idle: window.__IDLE__,
        inBackground: inBackground(),
      });
      if (
        snapStates.settings.autoRefresh &&
        scrollableRef.current.scrollTop === 0 &&
        (disableIdleCheck || window.__IDLE__) &&
        !inBackground()
      ) {
        console.log('✨ Load updates', snapStates.settings.autoRefresh);
        loadItems(true);
      } else {
        console.log('✨ Check updates', snapStates.settings.autoRefresh);
        const hasUpdate = await checkForUpdates();
        if (hasUpdate) {
          console.log('✨ Has new updates', id);
          setShowNew(true);
        }
      }
    },
    [id, loadItems, checkForUpdates, snapStates.settings.autoRefresh],
  );
  const debouncedLoadOrCheckUpdates = useDebouncedCallback(
    loadOrCheckUpdates,
    3000,
  );

  const lastHiddenTime = useRef();
  usePageVisibility(
    (visible) => {
      if (visible) {
        const timeDiff = Date.now() - lastHiddenTime.current;
        if (!lastHiddenTime.current || timeDiff > 1000 * 60) {
          // 1 minute
          debouncedLoadOrCheckUpdates({
            disableIdleCheck: true,
          });
        }
      } else {
        lastHiddenTime.current = Date.now();
        debouncedLoadOrCheckUpdates.cancel();
      }
      setVisible(visible);
    },
    [checkForUpdates, loadOrCheckUpdates, snapStates.settings.autoRefresh],
  );

  // checkForUpdates interval
  useInterval(
    loadOrCheckUpdates,
    visible && !showNew ? checkForUpdatesInterval : null,
  );

  const hiddenUI = scrollDirection === 'end' && !nearReachStart;

  const formattedShortcuts = [
    {
      icon: "home",
      id: "home",
      path: "/",
      subtitle: undefined,
      title: "Home"
    },
    {
      id: 'trending',
      title: 'Trending',
      subtitle: '',
      path: instance.indexOf('skybridge.fly.dev') > -1 ? `/l/1961420711617101824`: instance.indexOf('masto.host') > -1 ? `/mastodon.social/trending` : `/${instance}/trending`,
      icon: 'chart',
    },
    {
      id: 'foryou',
      title: 'For You',
      subtitle: '',
      path: instance.indexOf('skybridge.fly.dev') > -1 ? `/l/1770979263374688256` : `/foryou`,
      icon: 'algorithm',
    },
    {
      id: 'search',
      title: 'Search',
      path: '/search',
      icon: 'search',
    },
  ]

  return (
    <div
      id={`${id}-page`}
      class="deck-container"
      ref={(node) => {
        scrollableRef.current = node;
        jRef.current = node;
        kRef.current = node;
        oRef.current = node;
      }}
      tabIndex="-1"
    >
      <div class="timeline-deck deck">
        <header
          hidden={hiddenUI}
          onClick={(e) => {
            if (!e.target.closest('a, button')) {
              scrollableRef.current?.scrollTo({
                top: 0,
                behavior: 'smooth',
              });
            }
          }}
          onDblClick={(e) => {
            if (!e.target.closest('a, button')) {
              loadItems(true);
            }
          }}
          class={uiState === 'loading' ? 'loading' : ''}
        >
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
              {/* {headerStart !== null && headerStart !== undefined ? (
                headerStart
              ) : (
                <Link to="/" class="button plain home-button">
                  <Icon icon="home" size="l" />
                </Link>
              )} */}
            </div>
            {/* {title && (titleComponent ? titleComponent : <h1>{title}</h1>)} */}
            <div class="home-tab-bar">
              <ul>
              {formattedShortcuts.map(
                ({ id, path, title, subtitle, icon }, i) => {
                  return (
                    <li key={i + title}>
                      <Link
                        class={subtitle ? 'has-subtitle' : ''}
                        to={path}
                        onClick={(e) => {
                          if (e.target.classList.contains('is-active')) {
                            e.preventDefault();
                            const page = document.getElementById(`${id}-page`);
                            console.log(id, page);
                            if (page) {
                              page.scrollTop = 0;
                              const updatesButton =
                                page.querySelector('.updates-button');
                              if (updatesButton) {
                                updatesButton.click();
                              }
                            }
                          }
                        }}
                      >
                        <Icon icon={icon} size="xl" alt={title} />
                        <span>
                          <AsyncText>{title}</AsyncText>
                          {subtitle && (
                            <>
                              <br />
                              <small>{subtitle}</small>
                            </>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                },
              )}
              </ul>
            </div>
            <div class="header-side">
              {/* <Loader hidden={uiState !== 'loading'} /> */}
              {!!headerEnd && headerEnd}
            </div>
          </div>
          {items?.length > 0 &&
            uiState !== 'loading' &&
            !hiddenUI &&
            showNew && (
              <button
                class="updates-button shiny-pill"
                type="button"
                onClick={() => {
                  loadItems(true);
                  scrollableRef.current?.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                  });
                }}
              >
                <Icon icon="arrow-up" /> New posts
              </button>
            )}
        </header>
        {!!timelineStart && (
          <div
            class={`timeline-start ${uiState === 'loading' ? 'loading' : ''}`}
          >
            {timelineStart}
          </div>
        )}
        {!!items?.length ? (
          <>
            <ul class="timeline">
              {items.map((status) => {
                const { id: statusID, reblog, items, type, _pinned } = status;
                const actualStatusID = reblog?.id || statusID;
                const url = instance
                  ? `/${instance}/s/${actualStatusID}`
                  : `/s/${actualStatusID}`;
                let title = '';
                if (type === 'boosts') {
                  title = `${items.length} Boosts`;
                } else if (type === 'pinned') {
                  title = 'Pinned posts';
                }
                const isCarousel = type === 'boosts' || type === 'pinned';
                if (items) {
                  if (isCarousel) {
                    // Here, we don't hide filtered posts, but we sort them last
                    items.sort((a, b) => {
                      if (a._filtered && !b._filtered) {
                        return 1;
                      }
                      if (!a._filtered && b._filtered) {
                        return -1;
                      }
                      return 0;
                    });
                    return (
                      <li
                        key={`timeline-${statusID}`}
                        class="timeline-item-carousel"
                      >
                        <StatusCarousel
                          title={title}
                          class={`${type}-carousel`}
                        >
                          {items.map((item) => {
                            const { id: statusID, reblog } = item;
                            const actualStatusID = reblog?.id || statusID;
                            const url = instance
                              ? `/${instance}/s/${actualStatusID}`
                              : `/s/${actualStatusID}`;
                            return (
                              <li key={statusID}>
                                <Link
                                  class="status-carousel-link timeline-item-alt"
                                  to={url}
                                >
                                  {useItemID ? (
                                    <Status
                                      statusID={statusID}
                                      instance={instance}
                                      size="s"
                                      contentTextWeight
                                      allowFilters={allowFilters}
                                    />
                                  ) : (
                                    <Status
                                      status={item}
                                      instance={instance}
                                      size="s"
                                      contentTextWeight
                                      allowFilters={allowFilters}
                                    />
                                  )}
                                </Link>
                              </li>
                            );
                          })}
                        </StatusCarousel>
                      </li>
                    );
                  }
                  const manyItems = items.length > 3;
                  return items.map((item, i) => {
                    const { id: statusID, _differentAuthor } = item;
                    const url = instance
                      ? `/${instance}/s/${statusID}`
                      : `/s/${statusID}`;
                    const isMiddle = i > 0 && i < items.length - 1;
                    const isSpoiler = item.sensitive && !!item.spoilerText;
                    const showCompact =
                      (!_differentAuthor && isSpoiler && i > 0) ||
                      (manyItems &&
                        isMiddle &&
                        (type === 'thread' ||
                          (type === 'conversation' &&
                            !_differentAuthor &&
                            !items[i - 1]._differentAuthor &&
                            !items[i + 1]._differentAuthor)));
                    if (!item.reblog || (item.reblog && (!item.reblog.inReplyToAccountId && !item.reblog.inReplyToId))){
                      return (
                        <li
                          key={`timeline-${statusID}`}
                          class={`timeline-item-container timeline-item-container-type-${type} timeline-item-container-${
                            i === 0
                              ? 'start'
                              : i === items.length - 1
                              ? 'end'
                              : 'middle'
                          } ${
                            _differentAuthor ? 'timeline-item-diff-author' : ''
                          }`}
                        >
                          <Link class="status-link timeline-item" to={url}>
                            {showCompact ? (
                              <TimelineStatusCompact
                                status={item}
                                instance={instance}
                              />
                            ) : useItemID ? (
                              <Status
                                statusID={statusID}
                                instance={instance}
                                allowFilters={allowFilters}
                              />
                            ) : (
                              <Status
                                status={item}
                                instance={instance}
                                allowFilters={allowFilters}
                              />
                            )}
                          </Link>
                        </li>
                      );
                    }
                  });
                }
                if (!status.reblog || (status.reblog && (!status.reblog.inReplyToAccountId && !status.reblog.inReplyToId))){
                  return (
                    <li class="status-container" key={`timeline-${statusID + _pinned}`}>
                      <Link class="status-link timeline-item" to={url}>
                        {useItemID ? (
                          <Status
                            statusID={statusID}
                            instance={instance}
                            allowFilters={allowFilters}
                          />
                        ) : (
                          <Status
                            status={status}
                            instance={instance}
                            allowFilters={allowFilters}
                          />
                        )}
                      </Link>
                    </li>
                  );
                }
              })}
              {showMore && uiState === 'loading' && (
                <>
                  <li
                    style={{
                      height: '20vh',
                    }}
                  >
                    <Status skeleton />
                  </li>
                  <li
                    style={{
                      height: '25vh',
                    }}
                  >
                    <Status skeleton />
                  </li>
                </>
              )}
            </ul>
            {uiState === 'default' &&
              (showMore ? (
                <InView
                  onChange={(inView) => {
                    if (inView) {
                      loadItems();
                    }
                  }}
                >
                  <button
                    type="button"
                    class="plain block"
                    onClick={() => loadItems()}
                    style={{ marginBlockEnd: '6em' }}
                  >
                    Show more&hellip;
                  </button>
                </InView>
              ) : (
                <p class="ui-state insignificant">The end.</p>
              ))}
          </>
        ) : uiState === 'loading' ? (
          <ul class="timeline">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i}>
                <Status skeleton />
              </li>
            ))}
          </ul>
        ) : (
          uiState !== 'error' && <p class="ui-state">{emptyText}</p>
        )}
        {uiState === 'error' && (
          <p class="ui-state">
            {errorText}
            <br />
            <br />
            <button
              class="button plain"
              onClick={() => loadItems(!items.length)}
            >
              Try again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function StatusCarousel({ title, class: className, children }) {
  const carouselRef = useRef();
  const { reachStart, reachEnd, init } = useScroll({
    scrollableRef: carouselRef,
    direction: 'horizontal',
  });
  useEffect(() => {
    init?.();
  }, []);

  return (
    <div class={`status-carousel ${className}`}>
      <header>
        <h3>{title}</h3>
        <span>
          <button
            type="button"
            class="small plain2"
            disabled={reachStart}
            onClick={() => {
              carouselRef.current?.scrollBy({
                left: -Math.min(320, carouselRef.current?.offsetWidth),
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="chevron-left" />
          </button>{' '}
          <button
            type="button"
            class="small plain2"
            disabled={reachEnd}
            onClick={() => {
              carouselRef.current?.scrollBy({
                left: Math.min(320, carouselRef.current?.offsetWidth),
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="chevron-right" />
          </button>
        </span>
      </header>
      <ul ref={carouselRef}>{children}</ul>
    </div>
  );
}

function TimelineStatusCompact({ status, instance }) {
  const snapStates = useSnapshot(states);
  const { id, visibility } = status;
  const statusPeekText = statusPeek(status);
  const sKey = statusKey(id, instance);
  return (
    <article
      class={`status compact-thread ${
        visibility === 'direct' ? 'visibility-direct' : ''
      }`}
      tabindex="-1"
    >
      {!!snapStates.statusThreadNumber[sKey] ? (
        <div class="status-thread-badge">
          <Icon icon="thread" size="s" />
          {snapStates.statusThreadNumber[sKey]
            ? ` ${snapStates.statusThreadNumber[sKey]}/X`
            : ''}
        </div>
      ) : (
        <div class="status-thread-badge">
          <Icon icon="thread" size="s" />
        </div>
      )}
      <div class="content-compact" title={statusPeekText}>
        {statusPeekText}
        {status.sensitive && status.spoilerText && (
          <>
            {' '}
            <span class="spoiler-badge">
              <Icon icon="eye-close" size="s" />
            </span>
          </>
        )}
      </div>
    </article>
  );
}

function inBackground() {
  return !!document.querySelector('.deck-backdrop, #modal-container > *');
}

export default Timeline;
