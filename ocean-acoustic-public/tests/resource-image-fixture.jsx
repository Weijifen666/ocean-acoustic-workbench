import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {KnowledgeImageButton,KnowledgeImageGallery,partitionKnowledgeImages} from '../src/ResourceImage';
import {KnowledgeImageButton as LocalButton,KnowledgeImageGallery as LocalGallery,partitionKnowledgeImages as localPartition} from '../../ocean-acoustic-workbench/src/ResourceImage';

const diagram={url:'/assets/knowledge/wave-equation.svg',kind:'authored_diagram',caption:'本项目原创原理示意 · 非教材原图、非仿真结果'};
const original={url:'/api/source/S21/page/2',kind:'source_page',caption:'教材原页 · S21 · PDF 第 2 页',availability:'unavailable'};
const supplement={url:'/api/source/S17/page/86',kind:'supplementary_source_page',caption:'补充教材原页 · S17 · PDF 第 86 页'};
for(const [Button,Gallery,partition] of [[KnowledgeImageButton,KnowledgeImageGallery,partitionKnowledgeImages],[LocalButton,LocalGallery,localPartition]]){
 const grouping=partition([diagram,original,supplement]);
 assert.deepEqual(grouping.visible,[diagram,supplement]);assert.deepEqual(grouping.missing,[original]);
 assert.deepEqual(partition([diagram,original,supplement],{[supplement.url]:true}).missing,[original,supplement]);
 const html=renderToStaticMarkup(<Gallery images={[diagram,original,supplement]} onOpen={()=>assert.fail('unloaded image cannot zoom')}/>);
 assert.match(html,/本项目原创原理示意/);assert.match(html,/补充教材原页/);assert.match(html,/<details/);assert.match(html,/<summary>1 张图片暂不可用/);
 assert.equal((html.match(/<img /g)||[]).length,2,'Missing original is retained in disclosure rather than making a broken clickable card');
 assert.equal((html.match(/disabled=""/g)||[]).length,2,'Images stay noninteractive until the browser confirms load');
 const single=renderToStaticMarkup(<Button image={diagram} onOpen={()=>assert.fail('not yet loaded')}/>);
 assert.match(single,/disabled=""/);assert.match(single,/图片加载中/);
}
console.log('Both galleries retain missing provenance, distinguish original/diagram/supplement and disable unloaded lightboxes');
