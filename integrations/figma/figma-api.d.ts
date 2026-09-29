/** Narrow adapter for the documented API members this importer uses. No runtime shim. */
interface Paint {type:'SOLID';color:{r:number;g:number;b:number};opacity?:number}
interface ImportNode {id:string;name:string;x:number;y:number;width:number;height:number;removed:boolean;fills:Paint[];strokes:Paint[];strokeWeight:number;opacity:number;rotation:number;resize(width:number,height:number):void;remove():void;setPluginData(key:string,value:string):void}
interface ImportFrame extends ImportNode {cornerRadius:number;clipsContent:boolean;appendChild(node:ImportNode):void;insertChild(index:number,node:ImportNode):void}
interface ImportText extends ImportNode {fontName:{family:string;style:string};fontSize:number;characters:string;textAutoResize:'HEIGHT'|'WIDTH_AND_HEIGHT'|'NONE';lineHeight:{unit:'PERCENT';value:number}}
interface ImportFigma {editorType:string;currentPage:{appendChild(node:ImportNode):void;selection:ImportNode[]};viewport:{center:{x:number;y:number};scrollAndZoomIntoView(nodes:ImportNode[]):void};createFrame():ImportFrame;createText():ImportText;createLine():ImportNode;loadFontAsync(font:{family:string;style:string}):Promise<void>;showUI(html:string,options:{width:number;height:number;themeColors:boolean}):void;ui:{onmessage:(message:unknown)=>void;postMessage(message:unknown):void};notify(message:string):void}
declare const figma:ImportFigma;
declare const __html__:string;
