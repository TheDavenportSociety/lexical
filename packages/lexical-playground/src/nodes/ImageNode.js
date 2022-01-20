/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {
  EditorConfig,
  NodeKey,
  LexicalNode,
  LexicalEditor,
  DecoratorMap,
  DecoratorEditor,
} from 'lexical';

import * as React from 'react';
import {
  DecoratorNode,
  $log,
  $getNodeByKey,
  createDecoratorEditor,
} from 'lexical';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {
  useCollaborationContext,
  CollaborationPlugin,
} from '@lexical/react/LexicalCollaborationPlugin';
import {Suspense, useCallback, useRef, useState} from 'react';
import RichTextPlugin from '@lexical/react/LexicalRichTextPlugin';
import Placeholder from '../ui/Placeholder';
import ContentEditable from '../ui/ContentEditable';
import {createWebsocketProvider} from '../collaboration';
import HistoryPlugin from '@lexical/react/LexicalHistoryPlugin';
import {useSharedHistoryContext} from '../context/SharedHistoryContext';
import LexicalNestedComposer from '@lexical/react/LexicalNestedComposer';
import useLexicalDecoratorMap from '@lexical/react/useLexicalDecoratorMap';
import MentionsPlugin from '../plugins/MentionsPlugin';
import EmojisPlugin from '../plugins/EmojisPlugin';
import HashtagsPlugin from '@lexical/react/LexicalHashtagPlugin';
import KeywordsPlugin from '../plugins/KeywordsPlugin';
import TablesPlugin from '@lexical/react/LexicalTablePlugin';
import TableCellActionMenuPlugin from '../plugins/TableActionMenuPlugin';
import ImagesPlugin from '../plugins/ImagesPlugin';
import LinkPlugin from '@lexical/react/LexicalLinkPlugin';
import stylex from 'stylex';

const styles = stylex.create({
  contentEditable: {
    minHeight: 0,
    border: 0,
    resize: 'none',
    cursor: 'text',
    caretColor: 'rgb(5, 5, 5)',
    display: 'block',
    position: 'relative',
    tabSize: 1,
    outline: 0,
    padding: 10,
    userSelect: 'text',
    fontSize: 12,
    width: 'calc(100% - 20px)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  },
  placeholder: {
    fontSize: 12,
    color: '#888',
    overflow: 'hidden',
    position: 'absolute',
    textOverflow: 'ellipsis',
    top: 10,
    left: 10,
    userSelect: 'none',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    pointerEvents: 'none',
  },
});

const imageCache = new Set();

function useSuspenseImage(src: string) {
  if (!imageCache.has(src)) {
    throw new Promise((resolve) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        imageCache.add(src);
        resolve();
      };
    });
  }
}

function LazyImage({
  altText,
  className,
  imageRef,
  onFocus,
  onBlur,
  onKeyDown,
  src,
  width,
  height,
  maxWidth,
}: {
  altText: string,
  className: ?string,
  imageRef: {current: null | HTMLElement},
  onFocus: () => void,
  onBlur: () => void,
  onKeyDown: (KeyboardEvent) => void,
  src: string,
  width: 'inherit' | number,
  height: 'inherit' | number,
  maxWidth: number,
}): React.Node {
  useSuspenseImage(src);
  // TODO: This needs to be made accessible.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <img
      className={className}
      src={src}
      alt={altText}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      ref={imageRef}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      style={{
        width,
        height,
        maxWidth,
      }}
    />
  );
}

function ImageResizer({
  onResizeStart,
  onResizeEnd,
  imageRef,
  editor,
  showCaption,
  setShowCaption,
}: {
  onResizeStart: () => void,
  onResizeEnd: ('inherit' | number, 'inherit' | number) => void,
  imageRef: {current: null | HTMLElement},
  editor: LexicalEditor,
  showCaption: boolean,
  setShowCaption: (boolean) => void,
}): React.Node {
  const buttonRef = useRef(null);
  const positioningRef = useRef<{
    currentWidth: 'inherit' | number,
    currentHeight: 'inherit' | number,
    ratio: number,
    startWidth: number,
    startHeight: number,
    startX: number,
    startY: number,
    direction: 0 | 1 | 2 | 3,
    isResizing: boolean,
  }>({
    currentWidth: 0,
    currentHeight: 0,
    ratio: 0,
    startWidth: 0,
    startHeight: 0,
    startX: 0,
    startY: 0,
    direction: 0,
    isResizing: false,
  });
  const editorRootElement = editor.getRootElement();
  // Find max width, accounting for editor padding.
  const maxWidthContainer =
    editorRootElement !== null
      ? editorRootElement.getBoundingClientRect().width - 20
      : 100;

  const handlePointerDown = (event: PointerEvent, direction: 0 | 1 | 2 | 3) => {
    const image = imageRef.current;
    if (image !== null) {
      const {width, height} = image.getBoundingClientRect();
      const positioning = positioningRef.current;
      positioning.startWidth = width;
      positioning.startHeight = height;
      positioning.ratio = width / height;
      positioning.currentWidth = 'inherit';
      positioning.currentHeight = 'inherit';
      positioning.startX = event.clientX;
      positioning.startY = event.clientY;
      positioning.isResizing = true;
      positioning.direction = direction;
      onResizeStart();
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    }
  };
  const handlePointerMove = (event: PointerEvent) => {
    const image = imageRef.current;
    const positioning = positioningRef.current;

    if (image !== null && positioning.isResizing) {
      if (positioning.direction === 3) {
        const diff = Math.floor(positioning.startY - event.clientY) * 2;
        const minHeight = 150 * positioning.ratio;
        const maxHeight = maxWidthContainer / positioning.ratio;
        let height = positioning.startHeight + diff;
        if (height < minHeight) {
          height = minHeight;
        } else if (height > maxHeight) {
          height = maxHeight;
        }
        image.style.width = `inherit`;
        image.style.height = `${height}px`;
        positioning.currentHeight = height;
      } else if (positioning.direction === 2) {
        const diff = Math.floor(event.clientY - positioning.startY);
        const minHeight = 150 * positioning.ratio;
        const maxHeight = maxWidthContainer / positioning.ratio;
        let height = positioning.startHeight + diff;
        if (height < minHeight) {
          height = minHeight;
        } else if (height > maxHeight) {
          height = maxHeight;
        }
        image.style.width = `inherit`;
        image.style.height = `${height}px`;
        positioning.currentHeight = height;
      } else {
        const diff = Math.floor(event.clientX - positioning.startX);
        const minWidth = 150 * positioning.ratio;
        const maxWidth = maxWidthContainer;
        let width = positioning.startWidth + diff;
        if (width < minWidth) {
          width = minWidth;
        } else if (width > maxWidth) {
          width = maxWidth;
        }
        image.style.width = `${width}px`;
        image.style.height = `inherit`;
        positioning.currentWidth = width;
      }
    }
  };
  const handlePointerUp = (_event: PointerEvent) => {
    const image = imageRef.current;
    const positioning = positioningRef.current;
    if (image !== null && positioning.isResizing) {
      const width = positioning.currentWidth;
      const height = positioning.currentHeight;
      positioning.startWidth = 0;
      positioning.startHeight = 0;
      positioning.ratio = 0;
      positioning.startX = 0;
      positioning.startY = 0;
      positioning.currentWidth = 0;
      positioning.currentHeight = 0;
      positioning.isResizing = false;
      onResizeEnd(width, height);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    }
  };
  return (
    <>
      {!showCaption && (
        <button
          className="image-caption-button"
          ref={buttonRef}
          onClick={() => {
            setShowCaption(!showCaption);
          }}>
          Add Caption
        </button>
      )}
      <div
        className="image-resizer-ne"
        onPointerDown={(event) => {
          handlePointerDown(event, 0);
        }}
      />
      <div
        className="image-resizer-se"
        onPointerDown={(event) => {
          handlePointerDown(event, 1);
        }}
      />
      <div
        className="image-resizer-sw"
        onPointerDown={(event) => {
          handlePointerDown(event, 2);
        }}
      />
      <div
        className="image-resizer-nw"
        onPointerDown={(event) => {
          handlePointerDown(event, 3);
        }}
      />
    </>
  );
}

function ImageComponent({
  src,
  altText,
  nodeKey,
  width,
  height,
  maxWidth,
  resizable,
  showCaption,
  state,
}: {
  src: string,
  altText: string,
  nodeKey: NodeKey,
  width: 'inherit' | number,
  height: 'inherit' | number,
  maxWidth: number,
  resizable: boolean,
  showCaption: boolean,
  state: DecoratorMap,
}): React.Node {
  const ref = useRef(null);
  const [hasFocus, setHasFocus] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const {yjsDocMap} = useCollaborationContext();
  const [editor] = useLexicalComposerContext();
  const isCollab = yjsDocMap.get('main') !== undefined;
  const [decoratorEditor] = useLexicalDecoratorMap<DecoratorEditor>(
    state,
    'caption',
    () => createDecoratorEditor(),
  );

  const handleKeyDown = (event) => {
    if ((hasFocus && event.key === 'Backspace') || event.key === 'Delete') {
      editor.update(() => {
        $log('Image.keyDown');
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) {
          node.remove();
          event.stopPropagation();
          event.preventDefault();
        }
      });
    }
  };

  const setShowCaption = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) {
        node.setCaption(true);
      }
    });
  }, [editor, nodeKey]);

  const onResizeEnd = useCallback(
    (nextWidth, nextHeight) => {
      const rootElement = editor.getRootElement();
      if (rootElement !== null) {
        rootElement.style.setProperty('cursor', 'default');
      }
      setIsResizing(false);
      editor.update(() => {
        $log('ImageNode.resize');
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) {
          node.setWidthAndHeight(nextWidth, nextHeight);
        }
      });
    },
    [editor, nodeKey],
  );

  const onResizeStart = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (rootElement !== null) {
      rootElement.style.setProperty('cursor', 'nwse-resize', 'important');
    }
    setIsResizing(true);
  }, [editor]);

  const {historyState} = useSharedHistoryContext();

  return (
    <Suspense fallback={null}>
      <>
        <LazyImage
          className={hasFocus || isResizing ? 'focused' : null}
          src={src}
          altText={altText}
          imageRef={ref}
          onFocus={() => setHasFocus(true)}
          onBlur={() => {
            // Delay for 100ms so we can click the caption
            setTimeout(() => setHasFocus(false), 100);
          }}
          onKeyDown={handleKeyDown}
          width={width}
          height={height}
          maxWidth={maxWidth}
        />
        {showCaption && (
          <div className="image-caption-container">
            <LexicalNestedComposer initialDecoratorEditor={decoratorEditor}>
              <MentionsPlugin />
              <TablesPlugin />
              <TableCellActionMenuPlugin />
              <ImagesPlugin />
              <LinkPlugin />
              <EmojisPlugin />
              <HashtagsPlugin />
              <KeywordsPlugin />
              {isCollab ? (
                <CollaborationPlugin
                  id={decoratorEditor.id}
                  providerFactory={createWebsocketProvider}
                  initEditorState={false}
                />
              ) : (
                <HistoryPlugin externalHistoryState={historyState} />
              )}
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className={stylex(styles.contentEditable)} />
                }
                placeholder={
                  <Placeholder className={stylex(styles.placeholder)}>
                    Enter a caption...
                  </Placeholder>
                }
                skipInit={isCollab}
              />
            </LexicalNestedComposer>
          </div>
        )}
        {resizable && (hasFocus || isResizing) && (
          <ImageResizer
            showCaption={showCaption}
            setShowCaption={setShowCaption}
            editor={editor}
            imageRef={ref}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
          />
        )}
      </>
    </Suspense>
  );
}

export class ImageNode extends DecoratorNode {
  __src: string;
  __altText: string;
  __width: 'inherit' | number;
  __height: 'inherit' | number;
  __maxWidth: number;
  __caption: boolean;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__maxWidth,
      node.__state,
      node.__width,
      node.__height,
      node.__caption,
      node.__key,
    );
  }

  constructor(
    src: string,
    altText: string,
    maxWidth: number,
    state?: DecoratorMap,
    width?: 'inherit' | number,
    height?: 'inherit' | number,
    caption?: boolean,
    key?: NodeKey,
  ) {
    super(state, key);
    this.__src = src;
    this.__altText = altText;
    this.__maxWidth = maxWidth;
    this.__width = width || 'inherit';
    this.__height = height || 'inherit';
    this.__caption = caption || false;
  }

  setWidthAndHeight(
    width: 'inherit' | number,
    height: 'inherit' | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  setCaption(caption: boolean): void {
    const writable = this.getWritable();
    writable.__caption = caption;
  }

  // View

  createDOM<EditorContext>(config: EditorConfig<EditorContext>): HTMLElement {
    const span = document.createElement('span');
    const theme = config.theme;
    const className = theme.image;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(editor: LexicalEditor): React$Node {
    return (
      <ImageComponent
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        maxWidth={this.__maxWidth}
        nodeKey={this.getKey()}
        state={this.__state}
        showCaption={this.__caption}
        resizable={true}
      />
    );
  }
}

export function $createImageNode(
  src: string,
  altText: string,
  maxWidth: number,
): ImageNode {
  return new ImageNode(src, altText, maxWidth);
}

export function $isImageNode(node: ?LexicalNode): boolean %checks {
  return node instanceof ImageNode;
}