// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,it,expect} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MedicalSettingsEditor from './MedicalSettingsEditor';
import type {AppSettings} from '../types';
import {DEFAULT_SETTINGS,getMedicalSettings} from '../utils/settings';
afterEach(cleanup);
it('keeps the Admin reward maximum in whole numbers without changing saved invoice policies',()=>{
 function Form(){const [settings,setSettings]=useState<AppSettings>({...DEFAULT_SETTINGS,medicalSettings:{...getMedicalSettings(),maximumCombinedRewardPercentage:7.5}});return <MedicalSettingsEditor settings={settings} onChange={medicalSettings=>setSettings({...settings,medicalSettings})}/>;}
 const view=render(<Form/>);const field=screen.getByRole('spinbutton',{name:'Maximum Combined Reward Percentage'});expect(field).toHaveAttribute('step','1');expect(field).toHaveValue(8);fireEvent.change(field,{target:{value:'9.4'}});expect(field).toHaveValue(9);expect(view.container.querySelectorAll('p')).toHaveLength(0);
});
