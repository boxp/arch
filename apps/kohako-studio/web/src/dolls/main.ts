import { must } from '../must'
import '../candidates/style.css'
import './style.css'
import { DOLLS } from './data'
import { render } from './view'

const q = (id: string) => must(document.querySelector<HTMLElement>(id))
render(q('#grid'), q('#details'), q('#small'), DOLLS)
