"""Generate original, CC0 frog illustrations as local SVG assets. No external images/fonts."""
from pathlib import Path
poses = ['smug', 'thinking', 'happy', 'sad', 'dancing', 'sunglasses', 'focused', 'sleepy']
for pose in poses:
    eyes = '<ellipse cx="113" cy="105" rx="35" ry="33"/><ellipse cx="185" cy="103" rx="36" ry="34"/>'
    pupils = '<ellipse cx="120" cy="110" rx="9" ry="15" fill="#00ff00"/><ellipse cx="192" cy="108" rx="9" ry="15" fill="#00ff00"/>'
    mouth = '<path d="M77 174 Q149 220 226 167 M85 176 Q150 198 218 171"/>'
    props = ''
    if pose == 'smug':
        pupils = '<path d="M82 102 L142 110 M153 108 L216 96"/><circle cx="120" cy="116" r="7" fill="#00ff00"/><circle cx="193" cy="112" r="7" fill="#00ff00"/>'
        mouth = '<path d="M81 177 Q164 206 223 157 M175 185 L219 164"/>'
    elif pose == 'thinking':
        pupils = '<circle cx="129" cy="99" r="10" fill="#00ff00"/><circle cx="199" cy="96" r="10" fill="#00ff00"/>'
        mouth = '<path d="M88 184 Q128 167 160 181"/>'
        props = '<path d="M213 253 L210 199 Q239 164 224 158 Q212 153 194 178 L187 205 Q173 192 166 206 L182 253"/><path d="M237 52 Q235 27 257 29 Q281 31 263 50 L253 59 M252 73 L252 76"/>'
    elif pose == 'happy' or pose == 'dancing':
        pupils = '<path d="M92 110 Q112 83 132 108 M165 108 Q185 81 205 105"/>'
        mouth = '<path d="M79 163 Q151 190 226 159 Q218 218 152 219 Q95 215 79 163Z"/><path d="M106 199 Q150 181 195 201"/>'
        if pose == 'dancing': props = '<path d="M61 238 L28 191 L14 148 M239 238 L269 183 L288 142 M20 144 L6 128 M20 144 L34 129 M281 144 L295 130 M281 144 L270 128 M247 74 L253 52 L277 46 L272 69"/><circle cx="244" cy="77" r="7" fill="#00ff00"/><circle cx="266" cy="73" r="7" fill="#00ff00"/>'
    elif pose == 'sad':
        pupils = '<path d="M83 104 L139 94 M158 92 L213 105"/><ellipse cx="116" cy="117" rx="8" ry="11" fill="#00ff00"/><ellipse cx="184" cy="117" rx="8" ry="11" fill="#00ff00"/>'
        mouth = '<path d="M86 198 Q152 161 218 196 M100 201 Q152 177 204 200"/>'
        props = '<path d="M211 128 Q229 151 211 160 Q194 153 211 128Z"/>'
    elif pose == 'sunglasses':
        eyes = '<path d="M75 91 L143 91 L139 129 Q108 153 82 125Z M155 91 L224 91 L216 127 Q182 150 158 125Z" fill="#00ff00"/>'
        pupils = '<path d="M142 105 Q148 100 156 105"/><path d="M91 99 L111 99 L98 120 M172 99 L192 99 L179 120" stroke="#000"/>'
        props = '<path d="M64 82 L32 69 M230 82 L263 68 M42 38 L42 53 M35 45 L49 45 M268 105 L268 120 M261 112 L275 112"/>'
    elif pose == 'focused':
        pupils = '<path d="M81 85 L141 104 M159 103 L218 82"/><circle cx="120" cy="113" r="9" fill="#00ff00"/><circle cx="183" cy="112" r="9" fill="#00ff00"/>'
        mouth = '<path d="M87 187 L215 182 M102 195 L198 191"/>'
        props = '<path d="M64 241 L78 283 L236 283 L249 241Z"/><path d="M136 253 L148 262 L138 271 M159 271 L178 271"/>'
    elif pose == 'sleepy':
        pupils = '<path d="M84 106 L140 110 M158 109 L213 104"/>'
        mouth = '<ellipse cx="151" cy="186" rx="21" ry="12"/>'
        props = '<path d="M239 54 L265 54 L239 77 L265 77 M262 21 L280 21 L262 38 L280 38"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" role="img" aria-label="{pose} frog">
<title>{pose.capitalize()} frog — original imdbundler artwork</title>
<g fill="#000" stroke="#00ff00" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
<path d="M56 290 Q54 233 91 222 L208 222 Q250 236 248 290Z"/>
<path d="M60 128 Q54 80 83 69 Q112 39 148 71 Q186 39 217 69 Q248 82 239 131 Q266 156 241 199 Q210 232 150 234 Q86 235 59 203 Q31 163 60 128Z"/>
{eyes}{pupils}<path d="M65 146 Q77 133 91 143 M209 141 Q224 131 238 144"/>{mouth}{props}
</g></svg>'''
    Path(f'site/assets/pepe-{pose}.svg').write_text(svg+'\n')
